import { z } from 'zod';
import { dayStringSchema, objectIdSchema, paginationQuerySchema } from '@edunex/shared';
import { notFound } from '../../core/errors';
import type { Registrar } from '../../core/http/route';
import { staffRepo } from './staff.repository';
import { StaffService } from './staff.service';

const idParam = z.object({ id: objectIdSchema }).strict();
const dto = (s: Awaited<ReturnType<typeof staffRepo.getById>>) => ({
  id: String(s._id), employeeId: s.employeeId, name: s.name, phone: s.phone, email: s.email, designation: s.designation, department: s.department,
  kind: s.kind, joiningDate: s.joiningDate, status: s.status, endDate: s.endDate, version: s.__v,
});

export function registerStaffRoutes(r: Registrar) {
  r.define({
    method: 'get', path: '/staff', summary: 'List staff', tenancy: 'school', auth: 'session', permission: 'staff:read', allowOwnScope: true,
    query: paginationQuerySchema.extend({ kind: z.enum(['teaching', 'non_teaching']).optional(), status: z.enum(['active', 'on_leave', 'resigned', 'terminated']).optional() }).strict(),
    async handler({ query, scope, tenant }) {
      const filter: Record<string, unknown> = {};
      if (query.kind) filter.kind = query.kind;
      if (query.status) filter.status = query.status;
      if (scope === 'own') filter._id = tenant.personId ?? null; // own profile only
      const res = await staffRepo.paginate(filter, query.page, query.limit, { name: 1 });
      return { data: res.data.map(dto), meta: res.meta };
    },
  });

  r.define({
    method: 'post', path: '/staff', summary: 'Add a staff member', tenancy: 'school', auth: 'session', permission: 'staff:create',
    body: z.object({
      employeeId: z.string().trim().min(1).max(30), name: z.string().trim().min(1).max(120), phone: z.string().trim().max(20).optional(), email: z.string().trim().email().max(254).optional(),
      designation: z.string().trim().min(1).max(80), department: z.string().trim().max(80).optional(), kind: z.enum(['teaching', 'non_teaching']), joiningDate: dayStringSchema.optional(),
    }).strict(),
    audit: { exempt: 'StaffService records staff.created' },
    async handler({ body }) {
      return { status: 201, data: dto(await StaffService.create(body)) };
    },
  });

  r.define({
    method: 'get', path: '/staff/:id', summary: 'Staff profile', tenancy: 'school', auth: 'session', permission: 'staff:read', allowOwnScope: true,
    params: idParam, idParams: { id: 'staff' },
    async handler({ params, scope, tenant }) {
      if (scope === 'own' && String(tenant.personId) !== params.id) throw notFound('Staff member'); // own profile only
      return { data: dto(await staffRepo.getById(params.id, 'Staff member')) };
    },
  });

  r.define({
    method: 'patch', path: '/staff/:id', summary: 'Edit staff details', tenancy: 'school', auth: 'session', permission: 'staff:update',
    params: idParam, idParams: { id: 'staff' },
    body: z.object({ name: z.string().trim().min(1).max(120).optional(), phone: z.string().trim().max(20).optional(), email: z.string().trim().email().max(254).optional(), designation: z.string().trim().max(80).optional(), department: z.string().trim().max(80).optional(), version: z.number().int().min(0).optional() }).strict(),
    audit: true,
    async handler({ params, body }) {
      const { version, ...patch } = body;
      const s = await staffRepo.updateById(params.id, patch, { expectedVersion: version, what: 'Staff member' });
      return { data: dto(s), audit: { action: 'staff.updated', entityType: 'staff', entityId: params.id, after: patch } };
    },
  });

  r.define({
    method: 'post', path: '/staff/:id/status', summary: 'Change employment status (resign/terminate end access, keep history)', tenancy: 'school', auth: 'session', permission: 'staff:update', rateClass: 'sensitive',
    params: idParam, idParams: { id: 'staff' },
    body: z.object({ status: z.enum(['active', 'on_leave', 'resigned', 'terminated']), endDate: dayStringSchema.optional() }).strict(),
    audit: { exempt: 'StaffService records staff.status_changed' },
    async handler({ params, body }) {
      return { data: dto(await StaffService.setStatus(params.id, body.status, body.endDate)) };
    },
  });
}
