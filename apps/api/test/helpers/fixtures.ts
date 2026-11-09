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
