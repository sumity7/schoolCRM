import type { Types } from 'mongoose';
import { z } from 'zod';
import { objectIdSchema } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { forbidden } from '../../core/errors';
import { calendarRepo, sessionRepo, subjectRepo } from '../academics/academics.repository';
import { enrollmentRepo } from '../students/students.repository';
import { examRepo, examSubjectRepo } from '../exams/exams.repository';
import { assertChild, currentStudent, isGuardian } from '../parent/parent-access';

/**
 * Read-only school calendar + exam schedule for ONE student: school-wide holidays / events / PTMs of the active session,
 * and the exams of the student's own class (drafts are hidden — they are not final). The student is never taken from the
 * request: students get their own record, parents must pass a child that `assertChild` accepts.
 */
export async function calendarForStudent(studentId: Types.ObjectId) {
  const session = await sessionRepo.findActive();
  if (!session) return { session: null, events: [], exams: [] };
  const enr = await enrollmentRepo.findOne({ studentId, sessionId: session._id, status: 'active' });
  const events = await calendarRepo.find({ sessionId: session._id }, { sort: { date: 1 }, limit: 500 });
  let exams: Array<{ id: string; name: string; type: string; subjects: Array<{ subject: string; date: string | null; maxMarks: number }> }> = [];
  if (enr) {
    const rows = await examRepo.find({ sessionId: session._id, classIds: enr.classId, status: { $ne: 'draft' } }, { sort: { _id: 1 }, limit: 100 });
    const subs = await examSubjectRepo.find({ examId: { $in: rows.map((e) => e._id) }, classId: enr.classId }, { limit: 1000 });
    const names = new Map((await subjectRepo.findByIds([...new Set(subs.map((s) => String(s.subjectId)))])).map((s) => [String(s._id), s.name]));
    exams = rows.map((e) => ({
      id: String(e._id), name: e.name, type: e.type,
      subjects: subs.filter((s) => s.examId.equals(e._id))
        .map((s) => ({ subject: names.get(String(s.subjectId)) ?? '', date: s.date ?? null, maxMarks: s.maxMarks }))
        .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.subject.localeCompare(b.subject)),
    }));
  }
  return {
    session: session.name,
    events: events.map((e) => ({ id: String(e._id), date: e.date, endDate: e.endDate ?? null, type: e.type, title: e.title })),
    exams,
  };
}

export function registerSchoolCalendarRoutes(r: Registrar) {
  r.define({
    method: 'get', path: '/student/me/calendar', summary: 'My school calendar (holidays, events) and my class exam schedule', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'students:read',
    async handler() { return { data: await calendarForStudent((await currentStudent())._id) }; },
  });
  r.define({
    method: 'get', path: '/parent/children/:id/calendar', summary: 'A linked child school calendar and class exam schedule', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'students:read',
    params: z.object({ id: objectIdSchema }).strict(), idParams: { id: 'student' },
    async handler({ params }) {
      if (!isGuardian()) throw forbidden('This area is for parents and guardians');
      const link = await assertChild(params.id);
      return { data: await calendarForStudent(link.studentId) };
    },
  });
}
