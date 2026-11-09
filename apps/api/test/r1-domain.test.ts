import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Types } from 'mongoose';
import { addDays } from '@edunex/shared';
import { setupTestDb, teardownTestDb, clearAll } from './helpers/db';
import { loggedIn, makeTestApp, seedMember } from './helpers/app';
import { buildSchoolData, todayIst, type SchoolData } from './helpers/fixtures';
import { _auditRowsForTest } from '../src/core/audit/audit.service';
import { runAsPlatform } from '../src/core/tenancy/context';
import { AttendanceRecordModel } from '../src/modules/attendance/attendance.model';
import { attendanceRepo } from '../src/modules/attendance/attendance.repository';
import { runWithTenant } from '../src/core/tenancy/context';
import { makeCtx } from './helpers/tenant';

const t = makeTestApp();
const { app } = t;
let A: SchoolData;
let B: SchoolData;

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(async () => {
  await clearAll();
  A = await buildSchoolData(app, 'alpha');
  B = await buildSchoolData(app, 'bravo');
});

const today = todayIst();
const countRecords = (studentId: string) => runAsPlatform('test', async () => await AttendanceRecordModel.countDocuments({ studentId: new Types.ObjectId(studentId) }));

describe('REQ-ACA academic structure', () => {
  it('allows only ONE active session; closed sessions are immutable', async () => {
    const second = await A.owner.post('/academics/sessions', { name: '2027-28', startDate: '2027-04-01', endDate: '2028-03-31' });
    expect(second.status).toBe(201);
    expect((await A.owner.post(`/academics/sessions/${second.body.data.id}/activate`)).status).toBe(409);
    expect((await A.owner.post(`/academics/sessions/${A.sessionId}/close`)).status).toBe(200);
    expect((await A.owner.patch(`/academics/sessions/${A.sessionId}`, { name: 'x2' })).status).toBe(409);
    expect((await A.owner.post(`/academics/sessions/${second.body.data.id}/activate`)).status).toBe(200);
  });
  it('validates session dates and rejects duplicate names', async () => {
    expect((await A.owner.post('/academics/sessions', { name: 'bad', startDate: '2027-04-01', endDate: '2027-03-31' })).status).toBe(400);
    expect((await A.owner.post('/academics/sessions', { name: 'bad2', startDate: '2027-02-30', endDate: '2027-03-31' })).status).toBe(400);
    expect((await A.owner.post('/academics/sessions', { name: '2026-27', startDate: '2027-04-01', endDate: '2028-03-31' })).status).toBe(409);
  });
  it('enforces class/section uniqueness, soft-delete rules and history protection', async () => {
    expect((await A.owner.post('/classes', { sessionId: A.sessionId, name: 'Class 5' })).status).toBe(409);
    expect((await A.owner.post('/sections', { classId: A.classId, name: 'A' })).status).toBe(409);
    expect((await A.owner.delete(`/classes/${A.classId}`)).status).toBe(409); // has sections
    expect((await A.owner.delete(`/sections/${A.sectionA}`)).status).toBe(409); // has students
    const empty = await A.owner.post('/sections', { classId: A.classId, name: 'C' });
    expect((await A.owner.delete(`/sections/${empty.body.data.id}`)).status).toBe(204);
    expect((await A.owner.post('/sections', { classId: A.classId, name: 'C' })).status).toBe(201); // name reusable after soft delete
  });
  it('teacher assignments need an active TEACHING staff member of the same school', async () => {
    const nonTeaching = await A.owner.post('/staff', { employeeId: 'E-9', name: 'Clerk', designation: 'Clerk', kind: 'non_teaching' });
    expect((await A.owner.post('/academics/teacher-assignments', { staffId: nonTeaching.body.data.id, sectionId: A.sectionA })).status).toBe(400);
    expect((await A.owner.post('/academics/teacher-assignments', { staffId: B.teacherStaffId, sectionId: A.sectionA })).status).toBe(404); // other school's staff
    expect((await A.owner.post('/academics/teacher-assignments', { staffId: A.teacherStaffId, sectionId: B.sectionA })).status).toBe(404); // other school's section
    expect((await A.owner.post('/academics/teacher-assignments', { staffId: A.teacherStaffId, sectionId: A.sectionB })).status).toBe(201);
    expect((await A.owner.post('/academics/teacher-assignments', { staffId: A.teacherStaffId, sectionId: A.sectionB })).status).toBe(409);
  });
  it('cannot attach a school-B class/section/guardian to a school-A record (cross-reference attack)', async () => {
    expect((await A.owner.post('/sections', { classId: B.classId, name: 'Z' })).status).toBe(404);
    expect((await A.owner.post('/students', { admissionNo: 'X1', firstName: 'X', dob: '2015-01-01', enrollment: { sectionId: B.sectionA } })).status).toBe(404);
    expect((await A.owner.post(`/students/${A.studentsA[1]}/guardians`, { name: 'g', phone: '9000000000', relationship: 'father', existingGuardianId: new Types.ObjectId().toString() })).status).toBe(404);
  });
});

describe('REQ-STU students & guardians', () => {
  it('registers a student with enrolment and guardians; admission numbers are unique PER school', async () => {
    const res = await A.owner.post('/students', { admissionNo: 'ADM-100', firstName: 'Meera', dob: '2014-03-03', enrollment: { sectionId: A.sectionA, rollNo: 40 }, guardians: [{ name: 'Mohan', phone: '9822222222', relationship: 'father' }] });
    expect(res.status).toBe(201);
    expect(res.body.data.enrollment.rollNo).toBe(40);
    expect((await A.owner.post('/students', { admissionNo: 'ADM-100', firstName: 'Dup', dob: '2014-03-03' })).status).toBe(409);
    expect((await B.owner.post('/students', { admissionNo: 'ADM-100', firstName: 'Same number, other school', dob: '2014-03-03' })).status).toBe(201);
  });
  it('rejects invalid / future DOB, duplicate roll numbers and full sections', async () => {
    expect((await A.owner.post('/students', { admissionNo: 'F1', firstName: 'F', dob: '2999-01-01' })).status).toBe(400);
    expect((await A.owner.post('/students', { admissionNo: 'F2', firstName: 'F', dob: '2015-02-30' })).status).toBe(400);
    expect((await A.owner.post('/students', { admissionNo: 'F3', firstName: 'F', dob: '2015-02-02', enrollment: { sectionId: A.sectionA, rollNo: 1 } })).status).toBe(409);
    const tiny = await A.owner.post('/sections', { classId: A.classId, name: 'Tiny', capacity: 1 });
    expect((await A.owner.post('/students', { admissionNo: 'F4', firstName: 'F', dob: '2015-02-02', enrollment: { sectionId: tiny.body.data.id } })).status).toBe(201);
    expect((await A.owner.post('/students', { admissionNo: 'F5', firstName: 'F', dob: '2015-02-02', enrollment: { sectionId: tiny.body.data.id } })).status).toBe(409);
  });
  it('enforces the plan student limit (existing data stays readable)', async () => {
    const { schools } = await import('../src/modules/auth/auth.repository');
    await schools.updateOne({ _id: A.school.schoolId }, { $set: { 'limits.students': 6 } }, 'test'); // A already has 6
    const res = await A.owner.post('/students', { admissionNo: 'L1', firstName: 'L', dob: '2015-02-02' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ENTITLEMENT_REQUIRED');
    expect((await A.owner.get('/students')).body.meta.total).toBe(6);
  });
  it('searches by name prefix, admission number and phone; filters by section; paginates', async () => {
    expect((await A.owner.get('/students?q=asha')).body.meta.total).toBe(3);
    expect((await A.owner.get('/students?q=ASHA2')).body.data[0].firstName).toBe('Asha2');
    expect((await A.owner.get('/students?q=alpha-b1')).body.data[0].admissionNo).toBe('alpha-B1');
    expect((await A.owner.get('/students?q=9800000020')).body.data[0].firstName).toBe('Asha2');
    expect((await A.owner.get(`/students?sectionId=${A.sectionB}`)).body.meta.total).toBe(3);
    const p = await A.owner.get('/students?limit=4&page=2');
    expect(p.body.meta).toMatchObject({ page: 2, limit: 4, total: 6, totalPages: 2 });
    expect(p.body.data).toHaveLength(2);
    expect((await A.owner.get('/students?q=.*')).body.meta.total).toBe(0); // regex metacharacters are escaped
    expect((await A.owner.get('/students?limit=1000')).status).toBe(400);
  });
  it('teacher scope: sees only students of assigned sections — list, profile, roster', async () => {
    const list = await A.teacher.get('/students');
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(3);
    for (const s of list.body.data) expect(s.admissionNo.startsWith('alpha-A')).toBe(true);
    expect((await A.teacher.get(`/students/${A.studentsA[0]}`)).status).toBe(200);
    expect((await A.teacher.get(`/students/${A.studentsB[0]}`)).status).toBe(404); // exists in her school but not hers
    expect((await A.teacher.get(`/academics/sections/${A.sectionA}/roster`)).body.data.students).toHaveLength(3);
    expect((await A.teacher.get(`/academics/sections/${A.sectionB}/roster`)).status).toBe(403);
    expect((await A.teacher.post('/students', { admissionNo: 'T1', firstName: 'T', dob: '2015-01-01' })).status).toBe(403);
    expect((await A.teacher.patch(`/students/${A.studentsB[0]}`, { firstName: 'Hacked' })).status).toBe(403); // teachers hold students:read only
    // a class teacher may update students — but still only those of the assigned section
    await seedMember(A.school.schoolId, 'ct@alpha.test', ['class_teacher']);
    const { memberships } = await import('../src/modules/auth/auth.repository');
    const ctUser = await memberships.findOne({ roleKeys: 'class_teacher', schoolId: A.school.schoolId }, 'test');
    await memberships.updateOne({ _id: ctUser!._id }, { $set: { personId: new Types.ObjectId(A.teacherStaffId) } }, 'test');
    const ct = await loggedIn(app, 'ct@alpha.test');
    expect((await ct.patch(`/students/${A.studentsA[0]}`, { firstName: 'Ok' })).status).toBe(200);
    expect((await ct.patch(`/students/${A.studentsB[0]}`, { firstName: 'Hacked' })).status).toBe(404);
  });
  it('lifecycle: withdraw closes the enrolment but keeps all history; re-admit works; double-withdraw refused', async () => {
    const id = A.studentsA[1]!;
    expect((await A.owner.post(`/students/${id}/status`, { status: 'withdrawn', reason: 'Moved city' })).body.data.status).toBe('withdrawn');
    expect((await A.owner.post(`/students/${id}/status`, { status: 'withdrawn' })).status).toBe(409);
    expect((await A.owner.get(`/academics/sections/${A.sectionA}/roster`)).body.data.students).toHaveLength(2);
    expect((await A.owner.get(`/students/${id}`)).status).toBe(200); // never deleted
    expect((await A.owner.post(`/students/${id}/status`, { status: 'active' })).status).toBe(400); // needs a section
    const back = await A.owner.post(`/students/${id}/status`, { status: 'active', sectionId: A.sectionB });
    expect(back.body.data.status).toBe('active');
    expect(back.body.data.enrollment.sectionId).toBe(A.sectionB);
  });
  it('optimistic locking and audit trail on student edits', async () => {
    const id = A.studentsA[0]!;
    const cur = (await A.owner.get(`/students/${id}`)).body.data;
    expect((await A.owner.patch(`/students/${id}`, { firstName: 'Ashaa', version: cur.version })).status).toBe(200);
    expect((await A.owner.patch(`/students/${id}`, { firstName: 'Stale', version: cur.version })).status).toBe(409);
    const rows = await _auditRowsForTest({ action: 'students.updated', schoolId: A.school.schoolId });
    expect(rows.length).toBeGreaterThan(0);
  });
  it('guardian links: verification is required before portal access; siblings reuse a guardian; ending a link revokes access', async () => {
    const link = A.guardianLinkId;
    const s1 = A.studentsA[0]!;
    expect((await A.owner.patch(`/students/${s1}/guardians/${link}`, { portalAccess: true })).status).toBe(400);
    expect((await A.owner.patch(`/students/${s1}/guardians/${link}`, { verified: true, portalAccess: true })).body.data.portalAccess).toBe(true);
    const guardians = (await A.owner.get(`/students/${s1}/guardians`)).body.data;
    const sib = await A.owner.post(`/students/${A.studentsA[1]}/guardians`, { name: 'x', phone: '9000000000', relationship: 'father', existingGuardianId: guardians[0].guardianId });
    expect(sib.status).toBe(201);
    expect((await A.owner.patch(`/students/${s1}/guardians/${link}`, { ended: true })).body.data.portalAccess).toBe(false);
    expect((await A.owner.patch(`/students/${s1}/guardians/${link}`, { verified: false })).body.data.verified).toBe(false);
  });
});

describe('REQ-ATT attendance', () => {
  const sheetBody = (ids: string[], status = 'present') => ({ date: today, entries: ids.map((studentId) => ({ studentId, status })) });

  it('teacher marks an assigned section; reload shows saved values; resubmitting NEVER duplicates', async () => {
    const body = sheetBody(A.studentsA);
    const r1 = await A.teacher.put(`/attendance/sections/${A.sectionA}`, { ...body, entries: [{ studentId: A.studentsA[0], status: 'absent', remark: 'fever' }, { studentId: A.studentsA[1], status: 'present' }, { studentId: A.studentsA[2], status: 'late' }] });
    expect(r1.status).toBe(200);
    expect(r1.body.data).toMatchObject({ saved: 3, created: 3, edited: 0 });
    await A.teacher.put(`/attendance/sections/${A.sectionA}`, body); // everyone present
    for (const id of A.studentsA) expect(await countRecords(id)).toBe(1);
    const sheet = await A.teacher.get(`/attendance/sections/${A.sectionA}?date=${today}`);
    expect(sheet.body.data.students.map((s: { status: string }) => s.status)).toEqual(['present', 'present', 'present']);
    expect(sheet.body.data.isWorkingDay).toBe(true);
  });
  it('the database itself forbids duplicate attendance (unique index)', async () => {
    await A.teacher.put(`/attendance/sections/${A.sectionA}`, sheetBody([A.studentsA[0]!]));
    const ctx = makeCtx(A.school.schoolId);
    await expect(
      runWithTenant(ctx, async () => {
        const { AttendanceRecordModel: M } = await import('../src/modules/attendance/attendance.model');
        await M.collection.insertOne({ schoolId: A.school.schoolId, sessionId: new Types.ObjectId(), studentId: new Types.ObjectId(A.studentsA[0]), sectionId: new Types.ObjectId(A.sectionA), date: today, status: 'absent', markedBy: new Types.ObjectId(), markedAt: new Date(), source: 'teacher' });
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
  it('teacher cannot mark unassigned or foreign sections; admin can; unknown ids are 404', async () => {
    expect((await A.teacher.put(`/attendance/sections/${A.sectionB}`, sheetBody(A.studentsB))).status).toBe(403);
    expect((await A.teacher.get(`/attendance/sections/${A.sectionB}?date=${today}`)).status).toBe(403);
    expect((await A.owner.put(`/attendance/sections/${A.sectionB}`, sheetBody(A.studentsB))).status).toBe(200);
    expect((await A.teacher.put(`/attendance/sections/${B.sectionA}`, sheetBody(B.studentsA))).status).toBe(404);
    expect((await A.owner.put(`/attendance/sections/${new Types.ObjectId()}`, sheetBody(A.studentsB))).status).toBe(404);
    expect(await countRecords(B.studentsA[0]!)).toBe(0);
  });
  it('all-or-nothing: one invalid student rejects the whole sheet; students of other sections/schools are refused', async () => {
    const res = await A.teacher.put(`/attendance/sections/${A.sectionA}`, { date: today, entries: [{ studentId: A.studentsA[0], status: 'present' }, { studentId: A.studentsB[0], status: 'present' }] });
    expect(res.status).toBe(422);
    expect(await countRecords(A.studentsA[0]!)).toBe(0);
    const cross = await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: today, entries: [{ studentId: B.studentsA[0], status: 'present' }] });
    expect(cross.status).toBe(422);
    expect((await A.teacher.put(`/attendance/sections/${A.sectionA}`, { date: today, entries: [{ studentId: A.studentsA[0], status: 'present' }, { studentId: A.studentsA[0], status: 'absent' }] })).status).toBe(400);
  });
  it('respects dates: no future days, nothing outside the session, no non-working days, no holidays', async () => {
    expect((await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: addDays(today, 1), entries: [{ studentId: A.studentsA[0], status: 'present' }] })).status).toBe(422);
    expect((await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: '2019-12-31', entries: [{ studentId: A.studentsA[0], status: 'present' }] })).status).toBe(422);
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
    await A.owner.patch('/schools/me/settings', { workingDays: [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== dow) });
    const closed = await A.owner.put(`/attendance/sections/${A.sectionA}`, sheetBody([A.studentsA[0]!]));
    expect(closed.status).toBe(422);
    expect(closed.body.error.message).toMatch(/working day/i);
    await A.owner.patch('/schools/me/settings', { workingDays: [1, 2, 3, 4, 5, 6, 7] });
    await A.owner.post('/academics/calendar/events', { date: today, type: 'holiday', title: 'Test holiday' });
    const hol = await A.owner.put(`/attendance/sections/${A.sectionA}`, sheetBody([A.studentsA[0]!]));
    expect(hol.status).toBe(422);
    expect(hol.body.error.message).toMatch(/Holiday/);
  });
  it('students who joined after the date are not enrolled for it', async () => {
    const yday = addDays(today, -1);
    const res = await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: yday, entries: [{ studentId: A.studentsA[0], status: 'present' }] });
    // students were admitted today (admissionDate = today) → not enrolled yesterday
    expect(res.status).toBe(422);
  });
  it('teacher edit window: past dates are locked for teachers (409) but open to admins, with a full audit of changes', async () => {
    const past = addDays(today, -3);
    // make the students "joined" long ago so that past dates are valid
    const { EnrollmentModel } = await import('../src/modules/students/students.model');
    await runAsPlatform('test', async () => await EnrollmentModel.updateMany({}, { $set: { joinedOn: '2020-01-01' } }));
    const locked = await A.teacher.put(`/attendance/sections/${A.sectionA}`, { date: past, entries: [{ studentId: A.studentsA[0], status: 'present' }] });
    expect(locked.status).toBe(409);
    expect((await A.teacher.get(`/attendance/sections/${A.sectionA}?date=${past}`)).body.data.locked).toBe(true);
    expect((await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: past, entries: [{ studentId: A.studentsA[0], status: 'present' }] })).status).toBe(200);
    const edit = await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: past, entries: [{ studentId: A.studentsA[0], status: 'absent' }] });
    expect(edit.body.data).toMatchObject({ edited: 1, created: 0 });
    const audit = (await _auditRowsForTest({ action: 'attendance.sheet_edited', schoolId: A.school.schoolId }))[0]!;
    expect((audit.meta as { changes: Array<{ from: string; to: string }> }).changes[0]).toMatchObject({ from: 'present', to: 'absent' });
  });
  it('correction workflow: request → approval by someone else → applied with before/after audit; no self-approval; no double decision', async () => {
    const { EnrollmentModel } = await import('../src/modules/students/students.model');
    await runAsPlatform('test', async () => await EnrollmentModel.updateMany({}, { $set: { joinedOn: '2020-01-01' } }));
    const past = addDays(today, -2);
    await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: past, entries: [{ studentId: A.studentsA[0], status: 'absent' }] });
    const req = await A.teacher.post('/attendance/corrections', { studentId: A.studentsA[0], date: past, to: 'excused', reason: 'Medical certificate received' });
    expect(req.status).toBe(201);
    expect((await A.teacher.post('/attendance/corrections', { studentId: A.studentsA[0], date: past, to: 'present', reason: 'dup pending' })).status).toBe(409);
    expect((await A.teacher.post(`/attendance/corrections/${req.body.data.id}/approve`)).status).toBe(403); // teachers have no approve permission
    expect((await A.teacher.post('/attendance/corrections', { studentId: A.studentsB[0], date: past, to: 'present', reason: 'not my class' })).status).toBe(403);
    const pending = await A.owner.get('/attendance/corrections');
    expect(pending.body.data).toHaveLength(1);
    expect((await A.owner.post(`/attendance/corrections/${req.body.data.id}/approve`, { note: 'ok' })).body.data.status).toBe('approved');
    expect((await A.owner.post(`/attendance/corrections/${req.body.data.id}/approve`)).status).toBe(409);
    const hist = await A.owner.get(`/attendance/students/${A.studentsA[0]}?from=${past}&to=${today}`);
    expect(hist.body.data.records[0]).toMatchObject({ date: past, status: 'excused' });
    const audit = (await _auditRowsForTest({ action: 'attendance.correction_approved', schoolId: A.school.schoolId }))[0]!;
    expect(audit.after).toMatchObject({ date: past, status: 'excused' });
  });
  it('percentages follow the school policy; low-attendance report lists the right students', async () => {
    const { EnrollmentModel } = await import('../src/modules/students/students.model');
    await runAsPlatform('test', async () => await EnrollmentModel.updateMany({}, { $set: { joinedOn: '2020-01-01' } }));
    // 6 marked days for student 0: 3 present, 1 late, 1 half_day, 1 absent → (3 + 1 + 0.5)/6 = 75%
    const statuses = ['present', 'present', 'present', 'late', 'half_day', 'absent'] as const;
    for (let i = 0; i < statuses.length; i++) {
      await A.owner.put(`/attendance/sections/${A.sectionA}`, { date: addDays(today, -(i + 1)), entries: [{ studentId: A.studentsA[0], status: statuses[i] }, { studentId: A.studentsA[1], status: 'present' }] });
    }
    const hist = await A.owner.get(`/attendance/students/${A.studentsA[0]}?from=${addDays(today, -10)}&to=${today}`);
    expect(hist.body.data.summary).toMatchObject({ markedDays: 6, present: 3, late: 1, halfDay: 1, absent: 1, percentage: 75 });
    await A.owner.patch('/schools/me/settings', { attendancePolicy: { lateCountsAsPresent: false } });
    expect((await A.owner.get(`/attendance/students/${A.studentsA[0]}?from=${addDays(today, -10)}&to=${today}`)).body.data.summary.percentage).toBe(58.33);
    const low = await A.owner.get(`/attendance/reports/low-attendance?sectionId=${A.sectionA}`);
    expect(low.body.data.rows.map((r: { studentId: string }) => r.studentId)).toEqual([A.studentsA[0]]);
    const month = addDays(today, -1).slice(0, 7);
    const monthly = await A.owner.get(`/attendance/reports/monthly?sectionId=${A.sectionA}&month=${month}`);
    expect(monthly.body.data.rows).toHaveLength(3);
  });
  it('10 concurrent saves of the same sheet leave exactly one record per student and no errors', async () => {
    const body = sheetBody(A.studentsA);
    const results = await Promise.all(Array.from({ length: 10 }, () => A.teacher.put(`/attendance/sections/${A.sectionA}`, body)));
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect([200, 409, 500].includes(r.status) && r.status !== 500).toBe(true);
    for (const id of A.studentsA) expect(await countRecords(id)).toBe(1);
    const ctx = makeCtx(A.school.schoolId);
    const total = await runWithTenant(ctx, () => attendanceRepo.count());
    expect(total).toBe(3);
  });
  it('another school cannot read or write this school’s attendance', async () => {
    await A.teacher.put(`/attendance/sections/${A.sectionA}`, sheetBody(A.studentsA));
    expect((await B.owner.get(`/attendance/sections/${A.sectionA}?date=${today}`)).status).toBe(404);
    expect((await B.owner.get(`/attendance/students/${A.studentsA[0]}?from=${today}&to=${today}`)).status).toBe(404);
    const bSheet = await B.owner.get(`/attendance/sections/${B.sectionA}?date=${today}`);
    expect(bSheet.body.data.students.every((s: { status: string | null }) => s.status === null)).toBe(true);
  });
  it('an admin without a staff link and a parent role cannot use staff attendance APIs incorrectly', async () => {
    await seedMember(A.school.schoolId, 'parent@alpha.test', ['parent'], { personType: 'guardian' });
    const p = await loggedIn(app, 'parent@alpha.test');
    expect((await p.get(`/attendance/sections/${A.sectionA}?date=${today}`)).status).toBe(403);
    expect((await p.get('/students')).status).toBe(403); // 'own' scope is served by the parent portal (R3), not the staff list
    expect((await p.put(`/attendance/sections/${A.sectionA}`, sheetBody(A.studentsA))).status).toBe(403);
  });
});
