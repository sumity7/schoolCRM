import { z } from 'zod';
import { dayStringSchema, objectIdSchema, paginationQuerySchema } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { StudentsService, toStudentDto } from './students.service';

const idParam = z.object({ id: objectIdSchema }).strict();
const phone = z.string().trim().min(7).max(20);
const guardianInput = z.object({
  name: z.string().trim().min(1).max(120), phone, email: z.string().trim().email().max(254).optional(),
  relationship: z.enum(['father', 'mother', 'guardian', 'other']), isPrimary: z.boolean().optional(), canViewFees: z.boolean().optional(),
}).strict();
const address = z.object({ line1: z.string().max(200), line2: z.string().max(200), city: z.string().max(80), state: z.string().max(80), postalCode: z.string().max(12) }).partial().strict();
const contact = z.object({ phone: phone.optional(), email: z.string().trim().email().max(254).optional() }).strict();
const emergency = z.array(z.object({ name: z.string().trim().min(1).max(120), relation: z.string().trim().min(1).max(40), phone }).strict()).max(3);

export function registerStudentRoutes(r: Registrar) {
  r.define({
    method: 'get', path: '/students', summary: 'Search/list students (teachers: assigned sections only)', tenancy: 'school', auth: 'session', permission: 'students:read',
    query: paginationQuerySchema.extend({
      status: z.enum(['active', 'transferred', 'withdrawn', 'graduated', 'alumni']).optional(), sectionId: objectIdSchema.optional(),
      classId: objectIdSchema.optional(), q: z.string().trim().max(60).optional(),
    }).strict(),
    async handler({ query, scope }) {
      const res = await StudentsService.list(scope, query);
      return { data: res.data, meta: res.meta };
    },
  });

  r.define({
    method: 'post', path: '/students', summary: 'Register a student (optionally enrol and add guardians)', tenancy: 'school', auth: 'session', permission: 'students:create',
    body: z.object({
      admissionNo: z.string().trim().min(1).max(30), firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().max(80).optional(), dob: dayStringSchema,
      gender: z.enum(['m', 'f', 'o', 'undisclosed']).optional(), contact: contact.optional(), address: address.optional(), emergencyContacts: emergency.optional(),
      admissionDate: dayStringSchema.optional(), enrollment: z.object({ sectionId: objectIdSchema, rollNo: z.number().int().min(1).max(999).optional() }).strict().optional(),
      guardians: z.array(guardianInput).max(4).optional(),
    }).strict(),
    audit: { exempt: 'StudentsService records students.created' },
    async handler({ body }) {
      const res = await StudentsService.create(body);
      return { status: 201, data: toStudentDto(res.student, res.enrollment) };
    },
  });

  r.define({
    method: 'get', path: '/students/:id', summary: 'Student profile', tenancy: 'school', auth: 'session', permission: 'students:read',
    params: idParam, idParams: { id: 'student' },
    async handler({ params, scope }) {
      const { student, enrollment } = await StudentsService.getVisible(scope, params.id);
      return { data: toStudentDto(student, enrollment) };
    },
  });

  r.define({
    method: 'patch', path: '/students/:id', summary: 'Edit student details', tenancy: 'school', auth: 'session', permission: 'students:update',
    params: idParam, idParams: { id: 'student' },
    body: z.object({
      firstName: z.string().trim().min(1).max(80).optional(), lastName: z.string().trim().max(80).optional(), dob: dayStringSchema.optional(),
      gender: z.enum(['m', 'f', 'o', 'undisclosed']).optional(), contact: contact.optional(), address: address.optional(), emergencyContacts: emergency.optional(),
      version: z.number().int().min(0).optional(),
    }).strict(),
    audit: { exempt: 'StudentsService records students.updated with before/after' },
    async handler({ params, body, scope }) {
      await StudentsService.getVisible(scope, params.id); // teachers can only edit students they may see
      const { version, ...patch } = body;
      const s = await StudentsService.update(params.id, patch, version);
      return { data: toStudentDto(s) };
    },
  });

  r.define({
    method: 'post', path: '/students/:id/status', summary: 'Transfer / withdraw / graduate / re-admit', tenancy: 'school', auth: 'session', permission: 'students:update', rateClass: 'sensitive',
    params: idParam, idParams: { id: 'student' },
    body: z.object({ status: z.enum(['transferred', 'withdrawn', 'graduated', 'active']), effectiveOn: dayStringSchema.optional(), reason: z.string().trim().max(300).optional(), sectionId: objectIdSchema.optional() }).strict(),
    audit: { exempt: 'StudentsService records students.status_changed' },
    async handler({ params, body, scope }) {
      await StudentsService.getVisible(scope, params.id);
      await StudentsService.changeStatus(params.id, body);
      const { student, enrollment } = await StudentsService.getVisible('school', params.id); // visibility was enforced above
      return { data: toStudentDto(student, enrollment) };
    },
  });

  r.define({
    method: 'get', path: '/students/:id/guardians', summary: 'Guardians linked to a student', tenancy: 'school', auth: 'session', permission: 'guardians:read',
    params: idParam, idParams: { id: 'student' },
    async handler({ params, scope }) {
      await StudentsService.getVisible(scope === 'school' ? 'school' : scope, params.id);
      return { data: await StudentsService.listGuardians(params.id) };
    },
  });

  r.define({
    method: 'post', path: '/students/:id/guardians', summary: 'Add a guardian (new, or an existing one for siblings)', tenancy: 'school', auth: 'session', permission: 'guardians:create',
    params: idParam, idParams: { id: 'student' },
    body: guardianInput.extend({ existingGuardianId: objectIdSchema.optional() }).strict(),
    audit: { exempt: 'StudentsService records students.guardian_linked' },
    async handler({ params, body }) {
      const link = await StudentsService.addGuardian(params.id, body);
      return { status: 201, data: { linkId: String(link._id) } };
    },
  });

  r.define({
    method: 'patch', path: '/students/:id/guardians/:linkId', summary: 'Update guardian link (verify, portal access, end link)', tenancy: 'school', auth: 'session', permission: 'guardians:update',
    params: z.object({ id: objectIdSchema, linkId: objectIdSchema }).strict(), idParams: { id: 'student', linkId: 'guardian_link' },
    body: z.object({
      relationship: z.enum(['father', 'mother', 'guardian', 'other']).optional(), isPrimary: z.boolean().optional(), canViewFees: z.boolean().optional(),
      canPickup: z.boolean().optional(), portalAccess: z.boolean().optional(), verified: z.boolean().optional(), ended: z.boolean().optional(),
    }).strict(),
    audit: { exempt: 'StudentsService records students.guardian_link_updated' },
    async handler({ params, body }) {
      const l = await StudentsService.updateLink(params.id, params.linkId, body);
      return { data: { linkId: String(l._id), portalAccess: l.portalAccess, verified: Boolean(l.verifiedAt), ended: Boolean(l.endedAt) } };
    },
  });

  r.define({
    method: 'get', path: '/academics/sections/:id/roster', summary: 'Class roster (teachers: assigned sections only)', tenancy: 'school', auth: 'session', permission: 'students:read',
    params: idParam, idParams: { id: 'section' },
    async handler({ params, scope }) {
      return { data: await StudentsService.roster(params.id, scope) };
    },
  });
}
