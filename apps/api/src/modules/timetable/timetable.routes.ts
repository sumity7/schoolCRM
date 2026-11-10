import { z } from 'zod';
import { objectIdSchema } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { forbidden, notFound } from '../../core/errors';
import { requireTenant } from '../../core/tenancy/context';
import { studentRepo } from '../students/students.repository';
import { assertChild, currentStudent, isGuardian } from '../parent/parent-access';
import { TimetableService, versionDto } from './timetable.service';

const period = z.object({ no: z.number().int().min(1).max(20), label: z.string().trim().min(1).max(40), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), kind: z.enum(['lesson', 'break']) }).strict();
const days = z.array(z.number().int().min(1).max(7)).min(1).max(7);
const versionParam = z.object({ versionId: objectIdSchema }).strict();
const viewQuery = z.object({ versionId: objectIdSchema.optional() }).strict();

/**
 * Timetable API (Phase B). Editing needs timetable:update / :create (school admins and owners). Everyone with
 * timetable:read sees only the PUBLISHED timetable; drafts are visible to editors only. Students and parents have
 * their own routes that derive the class from the server-side record, never from a client-supplied section.
 */
export function registerTimetableRoutes(r: Registrar) {
  // -------------------------------------------------------------------------------- editing (admin)
  r.define({
    method: 'get', path: '/timetable/versions', summary: 'All timetable versions (drafts, published, archived)', tenancy: 'school', auth: 'session', permission: 'timetable:update',
    query: z.object({ sessionId: objectIdSchema.optional() }).strict(),
    async handler({ query }) { return { data: await TimetableService.listVersions(query.sessionId) }; },
  });
  r.define({
    method: 'post', path: '/timetable/versions', summary: 'Create a draft timetable (period grid + working days)', tenancy: 'school', auth: 'session', permission: 'timetable:create',
    body: z.object({ sessionId: objectIdSchema.optional(), name: z.string().trim().min(1).max(80), workingDays: days.default([1, 2, 3, 4, 5, 6]), periods: z.array(period).min(1).max(20) }).strict(),
    audit: { exempt: 'TimetableService records timetable.version_created' },
    async handler({ body, auth }) { return { status: 201, data: versionDto(await TimetableService.createVersion(body, auth.user.name)) }; },
  });
  r.define({
    method: 'get', path: '/timetable/versions/:versionId', summary: 'One timetable version with its lesson count', tenancy: 'school', auth: 'session', permission: 'timetable:update',
    params: versionParam, idParams: { versionId: 'timetableVersion' },
    async handler({ params }) { return { data: await TimetableService.getVersion(params.versionId) }; },
  });
  r.define({
    method: 'patch', path: '/timetable/versions/:versionId', summary: 'Edit a DRAFT: name, period grid, working days', tenancy: 'school', auth: 'session', permission: 'timetable:update',
    params: versionParam, idParams: { versionId: 'timetableVersion' },
    body: z.object({ name: z.string().trim().min(1).max(80).optional(), workingDays: days.optional(), periods: z.array(period).min(1).max(20).optional() }).strict(),
    audit: { exempt: 'TimetableService records timetable.version_updated' },
    async handler({ params, body }) { return { data: versionDto(await TimetableService.updateVersion(params.versionId, body)) }; },
  });
  r.define({
    method: 'post', path: '/timetable/versions/:versionId/clone', summary: 'Start a new draft from any version (keeps history intact)', tenancy: 'school', auth: 'session', permission: 'timetable:create',
    params: versionParam, idParams: { versionId: 'timetableVersion' }, body: z.object({ name: z.string().trim().min(1).max(80).optional() }).strict(),
    audit: { exempt: 'TimetableService records timetable.version_cloned' },
    async handler({ params, body, auth }) { return { status: 201, data: versionDto(await TimetableService.clone(params.versionId, auth.user.name, body.name)) }; },
  });
  r.define({
    method: 'post', path: '/timetable/versions/:versionId/publish', summary: 'Publish a draft (the previous published version is archived)', tenancy: 'school', auth: 'session', permission: 'timetable:update', alsoRequire: ['timetable:create'],
    params: versionParam, idParams: { versionId: 'timetableVersion' }, body: z.object({}).strict(),
    audit: { exempt: 'TimetableService records timetable.published' },
    async handler({ params, auth }) { return { data: versionDto(await TimetableService.publish(params.versionId, auth.user.name)) }; },
  });
  r.define({
    method: 'put', path: '/timetable/versions/:versionId/lessons', summary: 'Place or change one lesson in a DRAFT (refuses teacher, room and class clashes)', tenancy: 'school', auth: 'session', permission: 'timetable:update',
    params: versionParam, idParams: { versionId: 'timetableVersion' },
    body: z.object({ sectionId: objectIdSchema, day: z.number().int().min(1).max(7), periodNo: z.number().int().min(1).max(20), subjectId: objectIdSchema, staffId: objectIdSchema, room: z.string().trim().max(30).nullable().optional() }).strict(),
    audit: { exempt: 'TimetableService records timetable.lesson_added / lesson_changed' },
    async handler({ params, body }) { const s = await TimetableService.setSlot(params.versionId, body); return { data: { id: String(s._id) } }; },
  });
  r.define({
    method: 'delete', path: '/timetable/versions/:versionId/lessons/:lessonId', summary: 'Remove a lesson from a DRAFT', tenancy: 'school', auth: 'session', permission: 'timetable:update',
    params: z.object({ versionId: objectIdSchema, lessonId: objectIdSchema }).strict(), idParams: { versionId: 'timetableVersion', lessonId: 'timetableSlot' },
    audit: { exempt: 'TimetableService records timetable.lesson_removed' },
    async handler({ params }) { await TimetableService.removeSlot(params.versionId, params.lessonId); return { status: 204 }; },
  });
  r.define({
    method: 'get', path: '/timetable/versions/:versionId/availability', summary: 'Free / busy teachers and busy rooms in one period of a version', tenancy: 'school', auth: 'session', permission: 'timetable:update',
    params: versionParam, idParams: { versionId: 'timetableVersion' }, query: z.object({ day: z.coerce.number().int().min(1).max(7), periodNo: z.coerce.number().int().min(1).max(20) }).strict(),
    async handler({ params, query }) { return { data: await TimetableService.availability(params.versionId, query.day, query.periodNo) }; },
  });

  // -------------------------------------------------------------------------------- read views
  r.define({
    method: 'get', path: '/timetable/sections/:sectionId', summary: 'A class timetable (published; editors may pass versionId to preview a draft)', tenancy: 'school', auth: 'session', permission: 'timetable:read',
    params: z.object({ sectionId: objectIdSchema }).strict(), idParams: { sectionId: 'section' }, query: viewQuery,
    async handler({ params, query, tenant }) { return { data: await TimetableService.sectionView(params.sectionId, query.versionId, tenant.grants.has('timetable:update')) }; },
  });
  r.define({
    method: 'get', path: '/timetable/teachers/:staffId', summary: 'A teacher timetable (published)', tenancy: 'school', auth: 'session', permission: 'timetable:read',
    params: z.object({ staffId: objectIdSchema }).strict(), idParams: { staffId: 'staff' }, query: viewQuery,
    async handler({ params, query, tenant }) { return { data: await TimetableService.teacherView(params.staffId, query.versionId, tenant.grants.has('timetable:update')) }; },
  });
  r.define({
    method: 'get', path: '/timetable/me', summary: 'My own timetable (teachers and other staff linked to a staff record)', tenancy: 'school', auth: 'session', permission: 'timetable:read', allowOwnScope: true,
    async handler() {
      const t = requireTenant('timetable.me');
      if (t.personType !== 'staff' || !t.personId) throw forbidden('This timetable is for staff members');
      return { data: await TimetableService.teacherView(String(t.personId), undefined, false) };
    },
  });
  r.define({
    method: 'get', path: '/student/me/timetable', summary: 'My class timetable (students)', tenancy: 'school', auth: 'session', permission: 'timetable:read', allowOwnScope: true,
    async handler() {
      const s = await currentStudent();
      const sectionId = await TimetableService.sectionOfStudent(s._id);
      if (!sectionId) return { data: { version: null, periods: [], workingDays: [], lessons: [] } };
      return { data: await TimetableService.sectionView(String(sectionId), undefined, false) };
    },
  });
  r.define({
    method: 'get', path: '/parent/children/:id/timetable', summary: 'A linked child class timetable', tenancy: 'school', auth: 'session', permission: 'timetable:read', allowOwnScope: true,
    params: z.object({ id: objectIdSchema }).strict(), idParams: { id: 'student' },
    async handler({ params }) {
      if (!isGuardian()) throw forbidden('This area is for parents and guardians');
      await assertChild(params.id);
      const s = await studentRepo.findById(params.id);
      if (!s) throw notFound('Student');
      const sectionId = await TimetableService.sectionOfStudent(s._id);
      if (!sectionId) return { data: { version: null, periods: [], workingDays: [], lessons: [] } };
      return { data: await TimetableService.sectionView(String(sectionId), undefined, false) };
    },
  });
}
