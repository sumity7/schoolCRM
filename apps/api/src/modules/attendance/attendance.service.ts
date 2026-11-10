import { Types } from 'mongoose';
import { isoWeekday, isValidDay, summariseAttendance, summariseCounts, todayInTz, type AttendanceStatusValue, type Scope } from '@edunex/shared';
import { conflict, notFound, validationFailed, AppError } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { withTransaction } from '../../core/db/connection';
import { requireTenant } from '../../core/tenancy/context';
import { AcademicsService } from '../academics/academics.service';
import { sessionRepo } from '../academics/academics.repository';
import { getSchoolById } from '../schools/schools.service';
import { enrollmentRepo, studentRepo } from '../students/students.repository';
import { attendanceRepo, correctionRepo } from './attendance.repository';
import type { SchoolSettings } from '../schools/school.model';

export interface SheetEntry {
  studentId: string;
  status: AttendanceStatusValue;
  remark?: string;
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

async function schoolContext() {
  const t = requireTenant('attendance');
  const school = await getSchoolById(t.schoolId);
  const settings = school.settings as SchoolSettings;
  return { tenant: t, settings, today: todayInTz(settings.timezone) };
}

export const AttendanceService = {
  /** Working-day rules: school's working weekdays and holidays. */
  async dayInfo(date: string, settings: SchoolSettings) {
    const working = settings.workingDays.includes(isoWeekday(date));
    const hol = await AcademicsService.isHoliday(date);
    return { isWorkingDay: working && !hol.holiday, reason: !working ? 'Not a working day' : hol.holiday ? `Holiday: ${hol.title}` : undefined };
  },

  async sheet(scope: Scope | undefined, sectionId: string, date: string) {
    if (!isValidDay(date)) throw validationFailed('Invalid date');
    const { settings, today } = await schoolContext();
    const section = await AcademicsService.assertSectionAccess(scope, sectionId);
    const enr = await enrollmentRepo.find({ sectionId: section._id, sessionId: section.sessionId, status: 'active', joinedOn: { $lte: date } }, { sort: { rollNo: 1 } });
    const [students, records] = await Promise.all([
      studentRepo.findByIds(enr.map((e) => e.studentId)),
      attendanceRepo.find({ sectionId: section._id, date }),
    ]);
    const sBy = new Map(students.map((s) => [String(s._id), s]));
    const rBy = new Map(records.map((r) => [String(r.studentId), r]));
    const info = await this.dayInfo(date, settings);
    return {
      date, today, sectionId: String(section._id), isWorkingDay: info.isWorkingDay, notice: info.reason,
      locked: scope !== 'school' && daysBetween(date, today) > settings.attendancePolicy.teacherEditWindowDays,
      students: enr
        .map((e) => {
          const s = sBy.get(String(e.studentId));
          const r = rBy.get(String(e.studentId));
          return { studentId: String(e.studentId), rollNo: e.rollNo, admissionNo: s?.admissionNo, name: [s?.firstName, s?.lastName].filter(Boolean).join(' '), status: r?.status ?? null, remark: r?.remark };
        })
        .sort((a, b) => (a.rollNo ?? 9999) - (b.rollNo ?? 9999) || a.name.localeCompare(b.name)),
    };
  },

  async save(scope: Scope | undefined, sectionId: string, date: string, entries: SheetEntry[]) {
    if (!isValidDay(date)) throw validationFailed('Invalid date');
    const { tenant, settings, today } = await schoolContext();
    const section = await AcademicsService.assertSectionAccess(scope, sectionId);
    const session = await sessionRepo.getById(section.sessionId, 'Session');
    if (session.status !== 'active') throw conflict('Attendance can only be marked in the active academic session');

    if (date > today) throw new AppError(422, 'VALIDATION_FAILED', 'Attendance cannot be marked for a future date');
    if (date < session.startDate || date > session.endDate) throw new AppError(422, 'VALIDATION_FAILED', 'Date is outside the academic session');
    const info = await this.dayInfo(date, settings);
    if (!info.isWorkingDay) throw new AppError(422, 'VALIDATION_FAILED', info.reason ?? 'Not a working day');
    if (entries.length === 0) throw validationFailed('No attendance entries supplied');
    if (new Set(entries.map((e) => e.studentId)).size !== entries.length) throw validationFailed('Duplicate students in the request');

    const enr = await enrollmentRepo.find({ sectionId: section._id, sessionId: section.sessionId, status: 'active', joinedOn: { $lte: date } }, { select: 'studentId' });
    const allowed = new Set(enr.map((e) => String(e.studentId)));
    const bad = entries.filter((e) => !allowed.has(e.studentId));
    if (bad.length) throw new AppError(422, 'VALIDATION_FAILED', 'Some students are not enrolled in this section on that date', bad.map((b) => ({ path: b.studentId, message: 'not enrolled' })));

    const existing = await attendanceRepo.find({ sectionId: section._id, date });
    const exBy = new Map(existing.map((r) => [String(r.studentId), r]));
    if (scope !== 'school' && daysBetween(date, today) > settings.attendancePolicy.teacherEditWindowDays) {
      throw conflict('This date is locked for teachers. Ask the class teacher or admin for a correction.');
    }

    const now = new Date();
    const changes: Array<{ studentId: string; from: string | null; to: string }> = [];
    for (const e of entries) {
      const prev = exBy.get(e.studentId)?.status ?? null;
      if (prev !== e.status) changes.push({ studentId: e.studentId, from: prev, to: e.status });
    }

    await withTransaction(async () => {
      await attendanceRepo.bulkWrite(
        entries.map((e) => ({
          updateOne: {
            filter: { studentId: new Types.ObjectId(e.studentId), date },
            update: {
              $set: { sessionId: section.sessionId, sectionId: section._id, status: e.status, remark: e.remark, lastEditedBy: tenant.membershipId, source: scope === 'school' ? 'admin' : 'teacher' },
              $setOnInsert: { markedBy: tenant.membershipId, markedAt: now },
            },
            upsert: true,
          },
        })) as never,
      );
    });
    const edited = changes.filter((c) => c.from !== null);
    await AuditService.record({
      action: edited.length ? 'attendance.sheet_edited' : 'attendance.sheet_saved',
      entityType: 'attendance_sheet', entityId: `${sectionId}:${date}`,
      meta: { sectionId, date, entries: entries.length, created: changes.length - edited.length, edited: edited.length, changes: changes.slice(0, 200) },
    });
    return { saved: entries.length, created: changes.length - edited.length, edited: edited.length, unchanged: entries.length - changes.length };
  },

  // ------------------------------------------------------------------ corrections
  async requestCorrection(scope: Scope | undefined, input: { studentId: string; date: string; to: AttendanceStatusValue; reason: string }) {
    const { tenant, today } = await schoolContext();
    if (!isValidDay(input.date) || input.date > today) throw validationFailed('Invalid date');
    const student = await studentRepo.getById(input.studentId, 'Student');
    const session = await AcademicsService.requireActiveSession();
    const enr = await enrollmentRepo.findOne({ studentId: student._id, sessionId: session._id });
    if (!enr) throw validationFailed('Student has no enrolment in the active session');
    await AcademicsService.assertSectionAccess(scope, enr.sectionId);
    const rec = await attendanceRepo.findOne({ studentId: student._id, date: input.date });
    if (await correctionRepo.exists({ studentId: student._id, date: input.date, status: 'pending' })) throw conflict('A correction for this student and date is already pending');
    const c = await correctionRepo.create({ attendanceRecordId: rec?._id ?? null, studentId: student._id, sectionId: enr.sectionId, date: input.date, from: rec?.status ?? null, to: input.to, reason: input.reason, requestedBy: tenant.membershipId, status: 'pending' });
    await AuditService.record({ action: 'attendance.correction_requested', entityType: 'attendance_correction', entityId: c._id, after: { date: input.date, to: input.to } });
    return c;
  },

  async decideCorrection(scope: Scope | undefined, id: string, decision: 'approved' | 'rejected', note?: string) {
    const { tenant } = await schoolContext();
    const c = await correctionRepo.getById(id, 'Correction');
    if (c.status !== 'pending') throw conflict('This correction has already been decided');
    await AcademicsService.assertSectionAccess(scope, c.sectionId);
    if (c.requestedBy.equals(tenant.membershipId) && scope !== 'school') throw new AppError(403, 'FORBIDDEN', 'You cannot approve your own correction request');
    await withTransaction(async () => {
      if (decision === 'approved') {
        const session = await AcademicsService.requireActiveSession();
        await attendanceRepo.bulkWrite([
          { updateOne: { filter: { studentId: c.studentId, date: c.date }, update: { $set: { sessionId: session._id, sectionId: c.sectionId, status: c.to, lastEditedBy: tenant.membershipId, source: 'correction' }, $setOnInsert: { markedBy: tenant.membershipId, markedAt: new Date() } }, upsert: true } },
        ] as never);
      }
      await correctionRepo.updateById(id, { status: decision, decidedBy: tenant.membershipId, decidedAt: new Date(), decisionNote: note });
    });
    await AuditService.record({ action: `attendance.correction_${decision}`, entityType: 'attendance_correction', entityId: id, before: { status: c.from }, after: { status: c.to, date: c.date, decision } });
    return correctionRepo.getById(id);
  },

  async listCorrections(scope: Scope | undefined, status: 'pending' | 'approved' | 'rejected', page: number, limit: number) {
    const tenant = requireTenant('attendance.corrections');
    const access = await AcademicsService.sectionAccess(tenant, scope);
    const filter: Record<string, unknown> = { status };
    if (!access.all) filter.sectionId = { $in: access.sectionIds };
    const res = await correctionRepo.paginate(filter, page, limit, { createdAt: -1 });
    const students = await studentRepo.findByIds(res.data.map((c) => c.studentId), { select: 'firstName lastName admissionNo' });
    const by = new Map(students.map((s) => [String(s._id), s]));
    return {
      meta: res.meta,
      data: res.data.map((c) => {
        const s = by.get(String(c.studentId));
        return { ...c, studentName: s ? [s.firstName, s.lastName].filter(Boolean).join(' ') : null, admissionNo: s?.admissionNo ?? null };
      }),
    };
  },

  // ------------------------------------------------------------------ views & reports
  async studentHistory(scope: Scope | undefined, studentId: string, from: string, to: string) {
    if (!isValidDay(from) || !isValidDay(to) || from > to || daysBetween(from, to) > 400) throw validationFailed('Invalid date range');
    const { settings } = await schoolContext();
    const student = await studentRepo.getById(studentId, 'Student');
    const session = await AcademicsService.requireActiveSession();
    const enr = await enrollmentRepo.findOne({ studentId: student._id, sessionId: session._id });
    if (!enr) throw notFound('Student');
    await AcademicsService.assertSectionAccess(scope, enr.sectionId);
    const records = await attendanceRepo.find({ studentId: student._id, date: { $gte: from, $lte: to } }, { sort: { date: 1 } });
    return { studentId, from, to, records: records.map((r) => ({ date: r.date, status: r.status, remark: r.remark })), summary: summariseAttendance(records.map((r) => r.status), settings.attendancePolicy) };
  },

  async monthlyReport(scope: Scope | undefined, sectionId: string, month: string) {
    if (!/^\d{4}-\d{2}$/.test(month) || !isValidDay(`${month}-01`)) throw validationFailed('month must be YYYY-MM');
    const { settings } = await schoolContext();
    const section = await AcademicsService.assertSectionAccess(scope, sectionId);
    const from = `${month}-01`;
    const [yy, mm] = month.split('-').map(Number) as [number, number];
    const to = `${month}-${String(new Date(Date.UTC(yy, mm, 0)).getUTCDate()).padStart(2, '0')}`;
    const [enr, records] = await Promise.all([
      enrollmentRepo.find({ sectionId: section._id, sessionId: section.sessionId, status: 'active' }),
      attendanceRepo.find({ sectionId: section._id, date: { $gte: from, $lte: to } }),
    ]);
    const students = await studentRepo.findByIds(enr.map((e) => e.studentId));
    const sBy = new Map(students.map((s) => [String(s._id), s]));
    const byStudent = new Map<string, AttendanceStatusValue[]>();
    for (const r of records) byStudent.set(String(r.studentId), [...(byStudent.get(String(r.studentId)) ?? []), r.status]);
    const days = new Set(records.map((r) => r.date));
    return {
      month, sectionId, markedDays: days.size,
      rows: enr.map((e) => ({ studentId: String(e.studentId), rollNo: e.rollNo, name: [sBy.get(String(e.studentId))?.firstName, sBy.get(String(e.studentId))?.lastName].filter(Boolean).join(' '), ...summariseAttendance(byStudent.get(String(e.studentId)) ?? [], settings.attendancePolicy) }))
        .sort((a, b) => (a.rollNo ?? 9999) - (b.rollNo ?? 9999) || a.name.localeCompare(b.name)),
    };
  },

  async lowAttendance(scope: Scope | undefined, sectionId: string | undefined) {
    const { tenant, settings, today } = await schoolContext();
    const session = await AcademicsService.requireActiveSession();
    const access = await AcademicsService.sectionAccess(tenant, scope);
    let sectionIds: Types.ObjectId[] | null = access.all ? null : access.sectionIds;
    if (sectionId) {
      const s = await AcademicsService.assertSectionAccess(scope, sectionId);
      sectionIds = [s._id];
    }
    const ef: Record<string, unknown> = { sessionId: session._id, status: 'active' };
    if (sectionIds) ef.sectionId = { $in: sectionIds };
    const enr = await enrollmentRepo.find(ef);
    // Counting happens IN the database (one row per student) — pulling every record into Node took ~4 s for a
    // 2,000-student school with 6 months of data (perf run 2026-11-10).
    const match: Record<string, unknown> = { sessionId: session._id, date: { $lte: today } };
    // restricted views count each listed student's records across ALL their sections this session (section changes)
    if (sectionIds) match.studentId = { $in: enr.map((e) => e.studentId) };
    const counted = await attendanceRepo.aggregate<{ _id: Types.ObjectId; present: number; absent: number; late: number; halfDay: number; excused: number }>([
      { $match: match },
      {
        $group: {
          _id: '$studentId',
          present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          absent: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
          late: { $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] } },
          halfDay: { $sum: { $cond: [{ $eq: ['$status', 'half_day'] }, 1, 0] } },
          excused: { $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] } },
        },
      },
    ]);
    const by = new Map(counted.map((c) => [String(c._id), c]));
    const zero = { present: 0, absent: 0, late: 0, halfDay: 0, excused: 0 };
    const threshold = settings.attendancePolicy.lowAttendanceThresholdPct;
    const low = enr
      .map((e) => ({ e, s: summariseCounts(by.get(String(e.studentId)) ?? zero, settings.attendancePolicy) }))
      .filter((x) => x.s.markedDays >= 5 && x.s.percentage !== null && x.s.percentage < threshold);
    const students = await studentRepo.findByIds(low.map((x) => x.e.studentId), { select: 'firstName lastName' });
    const sBy = new Map(students.map((s) => [String(s._id), s]));
    return {
      threshold,
      rows: low
        .map(({ e, s }) => ({ studentId: String(e.studentId), sectionId: String(e.sectionId), name: [sBy.get(String(e.studentId))?.firstName, sBy.get(String(e.studentId))?.lastName].filter(Boolean).join(' '), ...s }))
        .sort((a, b) => (a.percentage ?? 0) - (b.percentage ?? 0)),
    };
  },
};
