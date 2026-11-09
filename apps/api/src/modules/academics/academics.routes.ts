import { z } from 'zod';
import { dayStringSchema, objectIdSchema } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { AcademicsService } from './academics.service';
import { assignmentRepo, calendarRepo, classRepo, sectionRepo, sessionRepo, subjectRepo } from './academics.repository';
import { enrollmentRepo } from '../students/students.repository';

const idParam = z.object({ id: objectIdSchema }).strict();
const sessionDto = (s: { _id: unknown; name: string; startDate: string; endDate: string; status: string; __v: number }) => ({ id: String(s._id), name: s.name, startDate: s.startDate, endDate: s.endDate, status: s.status, version: s.__v });

export function registerAcademicsRoutes(r: Registrar) {
  // ------------------------------------------------------------ sessions
  r.define({
    method: 'get', path: '/academics/sessions', summary: 'List academic sessions', tenancy: 'school', auth: 'session', permission: 'academics:read',
    async handler() {
      return { data: (await sessionRepo.find({}, { sort: { startDate: -1 } })).map(sessionDto) };
    },
  });
  r.define({
    method: 'post', path: '/academics/sessions', summary: 'Create an academic session (draft)', tenancy: 'school', auth: 'session', permission: 'academics:create',
    body: z.object({ name: z.string().trim().min(2).max(40), startDate: dayStringSchema, endDate: dayStringSchema }).strict(), audit: true,
    async handler({ body }) {
      const s = await AcademicsService.createSession(body);
      return { status: 201, data: sessionDto(s), audit: { action: 'academics.session_created', entityType: 'session', entityId: s._id, after: body } };
    },
  });
  r.define({
    method: 'patch', path: '/academics/sessions/:id', summary: 'Edit a session name/dates', tenancy: 'school', auth: 'session', permission: 'academics:update',
    params: idParam, idParams: { id: 'session' },
    body: z.object({ name: z.string().trim().min(2).max(40).optional(), startDate: dayStringSchema.optional(), endDate: dayStringSchema.optional() }).strict(), audit: true,
    async handler({ params, body }) {
      const s = await AcademicsService.updateSession(params.id, body);
      return { data: sessionDto(s), audit: { action: 'academics.session_updated', entityType: 'session', entityId: params.id, after: body } };
    },
  });
  r.define({
    method: 'post', path: '/academics/sessions/:id/activate', summary: 'Activate a session (one active at a time)', tenancy: 'school', auth: 'session', permission: 'academics:approve',
    params: idParam, idParams: { id: 'session' }, body: z.object({}).strict(), audit: { exempt: 'AcademicsService records academics.session_activated' },
    async handler({ params }) {
      return { data: sessionDto(await AcademicsService.activateSession(params.id)) };
    },
  });
  r.define({
    method: 'post', path: '/academics/sessions/:id/close', summary: 'Close the active session', tenancy: 'school', auth: 'session', permission: 'academics:approve',
    params: idParam, idParams: { id: 'session' }, body: z.object({}).strict(), audit: { exempt: 'AcademicsService records academics.session_closed' },
    async handler({ params }) {
      return { data: sessionDto(await AcademicsService.closeSession(params.id)) };
    },
  });

  // ------------------------------------------------------------ classes
  r.define({
    method: 'get', path: '/classes', summary: 'List classes (default: active session)', tenancy: 'school', auth: 'session', permission: 'academics:read',
    query: z.object({ sessionId: objectIdSchema.optional() }).strict(),
    async handler({ query }) {
      const sessionId = query.sessionId ?? String((await sessionRepo.findActive())?._id ?? '');
      const rows = sessionId ? await classRepo.find({ sessionId: (await sessionRepo.getById(sessionId, 'Session'))._id }, { sort: { order: 1, name: 1 } }) : [];
      return { data: rows.map((c) => ({ id: String(c._id), sessionId: String(c.sessionId), name: c.name, order: c.order, stream: c.stream, version: c.__v })) };
    },
  });
  r.define({
    method: 'post', path: '/classes', summary: 'Create a class (grade level)', tenancy: 'school', auth: 'session', permission: 'academics:create',
    body: z.object({ sessionId: objectIdSchema, name: z.string().trim().min(1).max(60), order: z.number().int().min(0).max(100).optional(), stream: z.string().trim().max(40).optional() }).strict(), audit: true,
    async handler({ body }) {
      const c = await AcademicsService.createClass(body);
      return { status: 201, data: { id: String(c._id), name: c.name, order: c.order }, audit: { action: 'academics.class_created', entityType: 'class', entityId: c._id, after: body } };
    },
  });
  r.define({
    method: 'patch', path: '/classes/:id', summary: 'Edit a class', tenancy: 'school', auth: 'session', permission: 'academics:update',
    params: idParam, idParams: { id: 'class' }, body: z.object({ name: z.string().trim().min(1).max(60).optional(), order: z.number().int().min(0).max(100).optional(), stream: z.string().trim().max(40).optional() }).strict(), audit: true,
    async handler({ params, body }) {
      const c = await classRepo.updateById(params.id, body, { what: 'Class' });
      return { data: { id: String(c._id), name: c.name, order: c.order }, audit: { action: 'academics.class_updated', entityType: 'class', entityId: params.id, after: body } };
    },
  });
  r.define({
    method: 'delete', path: '/classes/:id', summary: 'Delete a class (soft; blocked while sections exist)', tenancy: 'school', auth: 'session', permission: 'academics:delete',
    params: idParam, idParams: { id: 'class' }, audit: { exempt: 'AcademicsService records academics.class_deleted' },
    async handler({ params }) {
      await AcademicsService.deleteClass(params.id);
      return { status: 204 };
    },
  });

  // ------------------------------------------------------------ sections
  r.define({
    method: 'get', path: '/sections', summary: 'List sections; teachers see only their assigned sections', tenancy: 'school', auth: 'session', permission: 'academics:read',
    query: z.object({ classId: objectIdSchema.optional(), mine: z.enum(['true', 'false']).optional() }).strict(),
    async handler({ query, tenant, scope }) {
      const session = await sessionRepo.findActive();
      if (!session) return { data: [] };
      const filter: Record<string, unknown> = { sessionId: session._id };
      if (query.classId) filter.classId = query.classId;
      let rows = await sectionRepo.find(filter, { sort: { name: 1 } });
      if (query.mine === 'true') {
        const access = await AcademicsService.sectionAccess(tenant, 'assigned');
        const mine = new Set(access.all ? [] : access.sectionIds.map(String));
        rows = rows.filter((s) => mine.has(String(s._id)));
      }
      const classes = await classRepo.find({ sessionId: session._id });
      const cBy = new Map(classes.map((c) => [String(c._id), c]));
      const counts = await Promise.all(rows.map((s) => enrollmentRepo.count({ sectionId: s._id, status: 'active' })));
      void scope;
      return { data: rows.map((s, i) => ({ id: String(s._id), classId: String(s.classId), className: cBy.get(String(s.classId))?.name, classOrder: cBy.get(String(s.classId))?.order ?? 0, name: s.name, capacity: s.capacity, classTeacherId: s.classTeacherId ? String(s.classTeacherId) : null, strength: counts[i], version: s.__v })) };
    },
  });
  r.define({
    method: 'post', path: '/sections', summary: 'Create a section', tenancy: 'school', auth: 'session', permission: 'academics:create',
    body: z.object({ classId: objectIdSchema, name: z.string().trim().min(1).max(30), capacity: z.number().int().min(1).max(500).optional(), classTeacherId: objectIdSchema.nullable().optional() }).strict(), audit: true,
    async handler({ body }) {
      const s = await AcademicsService.createSection(body);
      return { status: 201, data: { id: String(s._id), name: s.name }, audit: { action: 'academics.section_created', entityType: 'section', entityId: s._id, after: body } };
    },
  });
  r.define({
    method: 'patch', path: '/sections/:id', summary: 'Edit a section / set class teacher', tenancy: 'school', auth: 'session', permission: 'academics:update',
    params: idParam, idParams: { id: 'section' },
    body: z.object({ name: z.string().trim().min(1).max(30).optional(), capacity: z.number().int().min(1).max(500).optional(), classTeacherId: objectIdSchema.nullable().optional() }).strict(), audit: true,
    async handler({ params, body }) {
      const s = await AcademicsService.updateSection(params.id, body);
      return { data: { id: String(s._id), name: s.name }, audit: { action: 'academics.section_updated', entityType: 'section', entityId: params.id, after: body } };
    },
  });
  r.define({
    method: 'delete', path: '/sections/:id', summary: 'Delete a section (soft; blocked while students are enrolled)', tenancy: 'school', auth: 'session', permission: 'academics:delete',
    params: idParam, idParams: { id: 'section' }, audit: { exempt: 'AcademicsService records academics.section_deleted' },
    async handler({ params }) {
      await AcademicsService.deleteSection(params.id);
      return { status: 204 };
    },
  });

  // ------------------------------------------------------------ subjects
  r.define({
    method: 'get', path: '/subjects', summary: 'List subjects', tenancy: 'school', auth: 'session', permission: 'academics:read',
    async handler() {
      return { data: (await subjectRepo.find({}, { sort: { name: 1 } })).map((s) => ({ id: String(s._id), code: s.code, name: s.name, type: s.type, version: s.__v })) };
    },
  });
  r.define({
    method: 'post', path: '/subjects', summary: 'Create a subject', tenancy: 'school', auth: 'session', permission: 'academics:create',
    body: z.object({ code: z.string().trim().min(1).max(20), name: z.string().trim().min(1).max(80), type: z.enum(['core', 'optional', 'co_scholastic']).default('core') }).strict(), audit: true,
    async handler({ body }) {
      const s = await subjectRepo.create(body);
      return { status: 201, data: { id: String(s._id), code: s.code, name: s.name }, audit: { action: 'academics.subject_created', entityType: 'subject', entityId: s._id, after: body } };
    },
  });
  r.define({
    method: 'delete', path: '/subjects/:id', summary: 'Delete a subject (soft)', tenancy: 'school', auth: 'session', permission: 'academics:delete',
    params: idParam, idParams: { id: 'subject' }, audit: true,
    async handler({ params }) {
      await subjectRepo.softDeleteById(params.id, 'Subject');
      return { status: 204, audit: { action: 'academics.subject_deleted', entityType: 'subject', entityId: params.id } };
    },
  });

  // ------------------------------------------------------------ teacher assignments
  r.define({
    method: 'get', path: '/academics/teacher-assignments', summary: 'List teacher assignments (active session)', tenancy: 'school', auth: 'session', permission: 'academics:read',
    async handler() {
      const session = await sessionRepo.findActive();
      const rows = session ? await assignmentRepo.find({ sessionId: session._id }) : [];
      return { data: rows.map((a) => ({ id: String(a._id), staffId: String(a.staffId), sectionId: String(a.sectionId), subjectId: a.subjectId ? String(a.subjectId) : null, isClassTeacher: a.isClassTeacher })) };
    },
  });
  r.define({
    method: 'post', path: '/academics/teacher-assignments', summary: 'Assign a teacher to a section (and optionally a subject)', tenancy: 'school', auth: 'session', permission: 'academics:update',
    body: z.object({ staffId: objectIdSchema, sectionId: objectIdSchema, subjectId: objectIdSchema.nullable().optional() }).strict(), audit: true,
    async handler({ body }) {
      const a = await AcademicsService.assignTeacher(body);
      return { status: 201, data: { id: String(a._id) }, audit: { action: 'academics.teacher_assigned', entityType: 'teacher_assignment', entityId: a._id, after: body } };
    },
  });
  r.define({
    method: 'delete', path: '/academics/teacher-assignments/:id', summary: 'Remove a teacher assignment', tenancy: 'school', auth: 'session', permission: 'academics:update',
    params: idParam, idParams: { id: 'assignment' }, audit: { exempt: 'AcademicsService records academics.assignment_removed' },
    async handler({ params }) {
      await AcademicsService.removeAssignment(params.id);
      return { status: 204 };
    },
  });

  // ------------------------------------------------------------ calendar
  r.define({
    method: 'get', path: '/academics/calendar/events', summary: 'List calendar events / holidays (active session)', tenancy: 'school', auth: 'session', permission: 'academics:read',
    async handler() {
      const session = await sessionRepo.findActive();
      const rows = session ? await calendarRepo.find({ sessionId: session._id }, { sort: { date: 1 } }) : [];
      return { data: rows.map((e) => ({ id: String(e._id), date: e.date, endDate: e.endDate, type: e.type, title: e.title })) };
    },
  });
  r.define({
    method: 'post', path: '/academics/calendar/events', summary: 'Add a holiday or event', tenancy: 'school', auth: 'session', permission: 'academics:create',
    body: z.object({ date: dayStringSchema, endDate: dayStringSchema.optional(), type: z.enum(['holiday', 'event', 'exam', 'ptm']), title: z.string().trim().min(1).max(120) }).strict(), audit: true,
    async handler({ body }) {
      const e = await AcademicsService.addEvent(body);
      return { status: 201, data: { id: String(e._id) }, audit: { action: 'academics.event_created', entityType: 'calendar_event', entityId: e._id, after: body } };
    },
  });
  r.define({
    method: 'delete', path: '/academics/calendar/events/:id', summary: 'Delete a calendar event', tenancy: 'school', auth: 'session', permission: 'academics:delete',
    params: idParam, idParams: { id: 'event' }, audit: true,
    async handler({ params }) {
      await calendarRepo.hardDeleteById(params.id, 'Event');
      return { status: 204, audit: { action: 'academics.event_deleted', entityType: 'calendar_event', entityId: params.id } };
    },
  });
}
