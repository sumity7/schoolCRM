import type { Express } from 'express';
import { Types } from 'mongoose';
import { Client, loggedIn, seedMember, seedSchool, type SeededSchool } from './app';
import { todayInTz } from '@edunex/shared';
import { memberships } from '../../src/modules/auth/auth.repository';

export interface SchoolData {
  school: SeededSchool;
  owner: Client;
  sessionId: string;
  classId: string;
  sectionA: string;
  sectionB: string;
  subjectId: string;
  teacherStaffId: string;
  teacherEmail: string;
  teacher: Client;
  teacherMembershipId: Types.ObjectId;
  studentsA: string[];
  studentsB: string[];
  assignmentId: string;
  eventId: string;
  guardianLinkId: string;
}

const must = <T extends { status: number; body: unknown }>(res: T, expected: number, what: string): T => {
  if (res.status !== expected) throw new Error(`${what}: expected ${expected} got ${res.status} ${JSON.stringify(res.body)}`);
  return res;
};

/**
 * Builds a complete synthetic school through the REAL API (so fixtures obey the same rules as users):
 * active session covering today, every weekday a working day, one class, sections A+B, a teaching staff member
 * assigned to section A (with a login), and students in both sections.
 */
export async function buildSchoolData(app: Express, code: string, opts: { students?: number } = {}): Promise<SchoolData> {
  const school = await seedSchool(code);
  const owner = await loggedIn(app, school.ownerEmail);
  must(await owner.patch('/schools/me/settings', { workingDays: [1, 2, 3, 4, 5, 6, 7] }), 200, 'settings');
  const sess = must(await owner.post('/academics/sessions', { name: '2026-27', startDate: '2020-01-01', endDate: '2099-12-31' }), 201, 'session');
  const sessionId = sess.body.data.id as string;
  must(await owner.post(`/academics/sessions/${sessionId}/activate`), 200, 'activate');
  const cls = must(await owner.post('/classes', { sessionId, name: 'Class 5', order: 5 }), 201, 'class');
  const classId = cls.body.data.id as string;
  const sa = must(await owner.post('/sections', { classId, name: 'A', capacity: 60 }), 201, 'section A');
  const sb = must(await owner.post('/sections', { classId, name: 'B', capacity: 60 }), 201, 'section B');
  const sectionA = sa.body.data.id as string;
  const sectionB = sb.body.data.id as string;
  const subject = must(await owner.post('/subjects', { code: 'MAT', name: 'Mathematics', type: 'core' }), 201, 'subject');

  const staff = must(await owner.post('/staff', { employeeId: `E-${code}-1`, name: 'Tina Teacher', designation: 'Teacher', kind: 'teaching', email: `tina@${code}.test` }), 201, 'staff');
  const teacherStaffId = staff.body.data.id as string;
  const teacherEmail = `tina@${code}.test`;
  const tm = await seedMember(school.schoolId, teacherEmail, ['teacher'], { name: 'Tina Teacher' });
  await memberships.updateOne({ _id: tm.membershipId }, { $set: { personId: new Types.ObjectId(teacherStaffId) } }, 'test: link teacher to staff');
  const assignment = must(await owner.post('/academics/teacher-assignments', { staffId: teacherStaffId, sectionId: sectionA, subjectId: subject.body.data.id }), 201, 'assignment');

  const n = opts.students ?? 3;
  const studentsA: string[] = [];
  const studentsB: string[] = [];
  for (let i = 1; i <= n; i++) {
    const a = must(await owner.post('/students', { admissionNo: `${code}-A${i}`, firstName: `Asha${i}`, lastName: 'Rao', dob: '2015-05-05', gender: 'f', contact: { phone: `98000000${i}0` }, enrollment: { sectionId: sectionA, rollNo: i }, guardians: i === 1 ? [{ name: 'Ravi Rao', phone: '9811111111', relationship: 'father', isPrimary: true }] : [] }), 201, 'student A');
    studentsA.push(a.body.data.id);
    const b = must(await owner.post('/students', { admissionNo: `${code}-B${i}`, firstName: `Bala${i}`, lastName: 'Iyer', dob: '2015-06-06', enrollment: { sectionId: sectionB, rollNo: i } }), 201, 'student B');
    studentsB.push(b.body.data.id);
  }
  const links = must(await owner.get(`/students/${studentsA[0]}/guardians`), 200, 'guardians');
  const ev = must(await owner.post('/academics/calendar/events', { date: '2030-01-26', type: 'holiday', title: 'Republic Day' }), 201, 'event');
  const teacher = await loggedIn(app, teacherEmail);
  return {
    school, owner, sessionId, classId, sectionA, sectionB, subjectId: subject.body.data.id, teacherStaffId, teacherEmail, teacher,
    teacherMembershipId: tm.membershipId, studentsA, studentsB, assignmentId: assignment.body.data.id, eventId: ev.body.data.id, guardianLinkId: links.body.data[0].linkId,
  };
}

export const todayIst = () => todayInTz('Asia/Kolkata');

export interface FeeData { categoryId: string; structureId: string; invoiceId: string; paymentId: string; requestId: string; concessionId: string }

/** Fee setup through the real API: tuition head, published structure (Q1 overdue, Q2 future), Q1 billed to section A,
 * one ₹1,000 cash payment, a pending reversal request and an approved concession. */
export async function buildFeeData(sd: SchoolData, key = 'fx'): Promise<FeeData> {
  const o = sd.owner;
  const { addDays } = await import('@edunex/shared');
  const today = todayIst();
  const cat = must(await o.post('/fees/categories', { key: 'tuition', name: 'Tuition Fee', kind: 'tuition' }), 201, 'fee category');
  const st = must(await o.post('/fees/structures', {
    sessionId: sd.sessionId, classId: sd.classId, name: 'Standard',
    items: [{ categoryId: cat.body.data.id, installments: [{ label: 'Q1', dueDate: addDays(today, -10), amountPaise: 300_000 }, { label: 'Q2', dueDate: addDays(today, 80), amountPaise: 300_000 }] }],
  }), 201, 'structure');
  must(await o.post(`/fees/structures/${st.body.data.id}/publish`), 200, 'publish');
  must(await o.post('/fees/invoices/generate', { structureId: st.body.data.id, installmentLabel: 'Q1', sectionId: sd.sectionA }, { 'Idempotency-Key': `${key}-gen-q1` }), 200, 'generate');
  const inv = must(await o.get(`/fees/invoices?studentId=${sd.studentsA[0]}`), 200, 'invoices');
  const pay = must(await o.post('/fees/payments', { studentId: sd.studentsA[0], amountPaise: 100_000, mode: 'cash', paidOn: today }, { 'Idempotency-Key': `${key}-pay-1` }), 201, 'payment');
  const req = must(await o.post(`/fees/payments/${pay.body.data.payment.id}/reversal-requests`, { reason: 'fixture request' }), 201, 'reversal request');
  const con = must(await o.post('/fees/concessions', { studentId: sd.studentsA[1], kind: 'sibling', valueType: 'flat', value: 10_000, reason: 'fixture sibling' }), 201, 'concession');
  return { categoryId: cat.body.data.id, structureId: st.body.data.id, invoiceId: inv.body.data[0].id, paymentId: pay.body.data.payment.id, requestId: req.body.data.id, concessionId: con.body.data.id };
}

/** A parent login for an existing guardian link: verifies the link, enables portal access, and creates an ACTIVE
 * guardian membership (personType guardian, personId = guardian) — the state an accepted invitation produces. */
export async function seedParent(app: Express, sd: SchoolData, studentId: string, email: string) {
  const links = must(await sd.owner.get(`/students/${studentId}/guardians`), 200, 'guardians');
  const link = links.body.data[0] as { linkId: string; guardianId: string };
  must(await sd.owner.patch(`/students/${studentId}/guardians/${link.linkId}`, { verified: true }), 200, 'verify');
  must(await sd.owner.patch(`/students/${studentId}/guardians/${link.linkId}`, { portalAccess: true }), 200, 'portal');
  const pm = await seedMember(sd.school.schoolId, email, ['parent'], { personType: 'guardian', name: 'Parent' });
  await memberships.updateOne({ _id: pm.membershipId }, { $set: { personId: new Types.ObjectId(link.guardianId) } }, 'test: link parent to guardian');
  return { client: await loggedIn(app, email), linkId: link.linkId, guardianId: link.guardianId };
}

export interface ExamData { scaleId: string; examId: string; resultId: string }
/** Published grading scale, an exam on the fixture class with maths marks for section A, locked and computed. */
export async function buildExamData(sd: SchoolData): Promise<ExamData> {
  const o = sd.owner;
  const { DEFAULT_BANDS } = await import('@edunex/shared');
  const scale = must(await o.post('/exams/grading-scales', { name: 'Default', bands: DEFAULT_BANDS }), 201, 'scale');
  must(await o.post(`/exams/grading-scales/${scale.body.data.id}/publish`), 200, 'publish scale');
  const ex = must(await o.post('/exams', { name: 'Unit test 1', type: 'unit', classIds: [sd.classId], gradingScaleId: scale.body.data.id }), 201, 'exam');
  must(await o.put(`/exams/${ex.body.data.id}/subjects`, { subjects: [{ classId: sd.classId, subjectId: sd.subjectId, maxMarks: 50, passMarks: 17 }] }), 200, 'subjects');
  must(await o.post(`/exams/${ex.body.data.id}/open-marks`), 200, 'open');
  must(await o.put(`/exams/${ex.body.data.id}/marks`, { sectionId: sd.sectionA, subjectId: sd.subjectId, entries: sd.studentsA.map((studentId, i) => ({ studentId, obtained: 40 - i, status: 'entered' })) }), 200, 'marks');
  must(await o.put(`/exams/${ex.body.data.id}/marks`, { sectionId: sd.sectionB, subjectId: sd.subjectId, entries: sd.studentsB.map((studentId, i) => ({ studentId, obtained: 35 - i, status: 'entered' })) }), 200, 'marks B'); // complete, so the exam can be published
  must(await o.post(`/exams/${ex.body.data.id}/lock-marks`), 200, 'lock');
  must(await o.post(`/exams/${ex.body.data.id}/results/compute`), 200, 'compute');
  const res = must(await o.get(`/exams/${ex.body.data.id}/results?sectionId=${sd.sectionA}`), 200, 'results');
  return { scaleId: scale.body.data.id, examId: ex.body.data.id, resultId: res.body.data[0].id };
}

/** Staff issues activation access; the STUDENT activates and chooses their own password (as in production). */
export async function seedStudentLogin(app: Express, sd: SchoolData, studentId: string, password = 'Student-Pass-123') {
  const issued = must(await sd.owner.post(`/students/${studentId}/portal-access`), 201, 'issue student access');
  const token = /token=([A-Za-z0-9_-]+)/.exec(issued.body.data.activationUrl)![1]!;
  must(await new Client(app).post('/auth/accept-invite', { token, password }), 204, 'activate student');
  return { client: await loggedIn(app, issued.body.data.loginId, password), loginId: issued.body.data.loginId as string, password };
}
