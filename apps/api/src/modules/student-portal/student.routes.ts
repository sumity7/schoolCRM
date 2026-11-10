import { z } from 'zod';
import { addDays, dayStringSchema, objectIdSchema, summariseAttendance, todayInTz, type AttendanceStatusValue } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { notFound, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { classRepo, sectionRepo, sessionRepo } from '../academics/academics.repository';
import { attendanceRepo } from '../attendance/attendance.repository';
import { enrollmentRepo } from '../students/students.repository';
import { getSchoolById } from '../schools/schools.service';
import { getPortalPolicy } from '../schools/portal-policy';
import { BillingService } from '../fees/billing.service';
import { examRepo, resultRepo } from '../exams/exams.repository';
import { resultDto } from '../exams/exams.service';
import { reportCardFor } from '../exams/exams.routes';
import { currentStudent } from '../parent/parent-access';

/**
 * Student portal API. There is NO student id in any URL: every route works on the signed-in student's own record
 * (tenant context personId), so there is no object id to tamper with (IDOR-free by construction). Read-only.
 */
export function registerStudentPortalRoutes(r: Registrar) {
  r.define({
    method: 'get', path: '/student/me', summary: 'My profile, class, attendance, recent published results', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'students:read',
    async handler({ tenant }) {
      const s = await currentStudent();
      const school = await getSchoolById(tenant.schoolId);
      const policy = await getPortalPolicy();
      const today = todayInTz(school.settings.timezone);
      const session = await sessionRepo.findActive();
      const enr = session ? await enrollmentRepo.findOne({ studentId: s._id, sessionId: session._id }) : null;
      const [cls, sec] = enr ? await Promise.all([classRepo.findById(enr.classId), sectionRepo.findById(enr.sectionId)]) : [null, null];
      const recs = session ? await attendanceRepo.find({ studentId: s._id, sessionId: session._id, date: { $lte: today } }, { select: 'status date' }) : [];
      const sum = summariseAttendance(recs.map((x) => x.status as AttendanceStatusValue), school.settings.attendancePolicy);
      const results = await resultRepo.find({ studentId: s._id, current: true, publishedAt: { $ne: null } }, { sort: { publishedAt: -1 }, limit: 3 });
      const exams = new Map((await examRepo.findByIds(results.map((x) => x.examId))).map((e) => [String(e._id), e.name]));
      const fees = policy.studentsSeeFees ? (await BillingService.studentSummary(String(s._id))).totals : null;
      return {
        data: {
          profile: { name: [s.firstName, s.lastName].filter(Boolean).join(' '), admissionNo: s.admissionNo, dob: s.dob, gender: s.gender ?? null, admissionDate: s.admissionDate, phone: s.contact?.phone ?? null, email: s.contact?.email ?? null },
          class: { className: cls?.name ?? null, sectionName: sec?.name ?? null, rollNo: enr?.rollNo ?? null, session: session?.name ?? null },
          attendance: { percentage: sum.percentage, markedDays: sum.markedDays, present: sum.present, absent: sum.absent, late: sum.late, today: recs.find((x) => x.date === today)?.status ?? null, threshold: school.settings.attendancePolicy.lowAttendanceThresholdPct, low: sum.percentage !== null && sum.markedDays >= 5 && sum.percentage < school.settings.attendancePolicy.lowAttendanceThresholdPct },
          recentResults: results.map((x) => ({ id: String(x._id), examName: exams.get(String(x.examId)) ?? '', percentage: x.percentage, grade: x.grade, resultStatus: x.resultStatus, rank: policy.studentsSeeRank ? x.rank : null })),
          fees,
          policy: { studentsSeeFees: policy.studentsSeeFees, studentsSeeRank: policy.studentsSeeRank },
        },
      };
    },
  });

  r.define({
    method: 'get', path: '/student/me/attendance', summary: 'My attendance in a date range (read-only)', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'attendance:read',
    query: z.object({ from: dayStringSchema, to: dayStringSchema }).strict(),
    async handler({ query, tenant }) {
      const s = await currentStudent();
      if (query.from > query.to || addDays(query.from, 400) < query.to) throw validationFailed('Invalid date range');
      const school = await getSchoolById(tenant.schoolId);
      const recs = await attendanceRepo.find({ studentId: s._id, date: { $gte: query.from, $lte: query.to } }, { sort: { date: 1 }, select: 'date status remark' });
      return { data: { records: recs.map((x) => ({ date: x.date, status: x.status, remark: x.remark ?? null })), summary: summariseAttendance(recs.map((x) => x.status as AttendanceStatusValue), school.settings.attendancePolicy) } };
    },
  });

  r.define({
    method: 'get', path: '/student/me/results', summary: 'My PUBLISHED results (rank only if the school enables it)', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'results:read',
    async handler() {
      const s = await currentStudent();
      const policy = await getPortalPolicy();
      const rows = await resultRepo.find({ studentId: s._id, current: true, publishedAt: { $ne: null } }, { sort: { publishedAt: -1 } });
      const exams = new Map((await examRepo.findByIds(rows.map((x) => x.examId))).map((e) => [String(e._id), e]));
      return { data: await Promise.all(rows.map(async (x) => ({ ...(await resultDto(x)), rank: policy.studentsSeeRank ? x.rank : null, examName: exams.get(String(x.examId))?.name ?? '' }))) };
    },
  });

  r.define({
    method: 'get', path: '/student/me/results/:resultId/report-card.pdf', summary: 'My report card (PDF)', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'results:print',
    rateClass: 'export', params: z.object({ resultId: objectIdSchema }).strict(), idParams: { resultId: 'result' },
    async handler({ params, res, tenant }) {
      const s = await currentStudent();
      const r0 = await resultRepo.findById(params.resultId);
      if (!r0 || !r0.studentId.equals(s._id) || !r0.publishedAt) throw notFound('Result');
      const { pdf } = await reportCardFor(params.resultId, tenant.schoolId);
      await AuditService.record({ action: 'students.report_card_downloaded', entityType: 'result', entityId: r0._id });
      res.status(200).setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="report-card.pdf"');
      res.send(pdf);
    },
  });

  r.define({
    method: 'get', path: '/student/me/history', summary: 'My class history across sessions', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'students:read',
    async handler() {
      const s = await currentStudent();
      const enr = await enrollmentRepo.find({ studentId: s._id }, { sort: { joinedOn: -1 } });
      const [sessions, classes, sections] = await Promise.all([sessionRepo.find({}), classRepo.findByIds(enr.map((e) => e.classId)), sectionRepo.findByIds(enr.map((e) => e.sectionId))]);
      const sName = new Map(sessions.map((x) => [String(x._id), x.name]));
      const cName = new Map(classes.map((x) => [String(x._id), x.name]));
      const secName = new Map(sections.map((x) => [String(x._id), x.name]));
      return { data: enr.map((e) => ({ session: sName.get(String(e.sessionId)) ?? '', className: cName.get(String(e.classId)) ?? '', sectionName: secName.get(String(e.sectionId)) ?? '', rollNo: e.rollNo ?? null, status: e.status, joinedOn: e.joinedOn, leftOn: e.leftOn ?? null })) };
    },
  });

  r.define({
    method: 'get', path: '/student/me/fees', summary: 'My fee status (only if the school allows students to see fees)', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'students:read',
    async handler() {
      const s = await currentStudent();
      const policy = await getPortalPolicy();
      if (!policy.studentsSeeFees) throw notFound('Fee details');
      const f = await BillingService.studentSummary(String(s._id));
      return { data: { totals: f.totals, invoices: f.invoices.filter((i) => i.status !== 'void').map((i) => ({ invoiceNo: i.invoiceNo, installmentLabel: i.installmentLabel, dueDate: i.dueDate, totalPaise: i.totalPaise, balancePaise: i.balancePaise, status: i.status })) } };
    },
  });
}
