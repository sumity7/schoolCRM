import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from '@edunex/shared';
import type { Env } from '../../config/env';
import type { EmailAdapter } from '../../core/notifications/email';
import type { Registrar } from '../../core/http/route';
import type { SessionService } from '../auth/session.service';
import { roleRepository } from '../roles/roles.repository';
import { ParentPortalService } from './parents.service';
import { StudentAccessService } from './student-access.service';
import { UsersService } from './users.service';

export function registerUserRoutes(r: Registrar, deps: { env: Env; email: EmailAdapter; sessions: SessionService }) {
  const svc = new UsersService(deps);
  const parents = new ParentPortalService(deps);
  const studentAccess = new StudentAccessService(deps);

  r.define({
    method: 'get', path: '/students/:id/portal-access', summary: 'Student login status (never shows a password)', tenancy: 'school', auth: 'session', permission: 'students:update',
    params: z.object({ id: objectIdSchema }).strict(), idParams: { id: 'student' },
    async handler({ params }) { return { data: await studentAccess.status(params.id) }; },
  });
  r.define({
    method: 'post', path: '/students/:id/portal-access', summary: 'Issue (or reset) one-time activation access for a student', tenancy: 'school', auth: 'session', permission: 'students:update', rateClass: 'sensitive',
    params: z.object({ id: objectIdSchema }).strict(), idParams: { id: 'student' }, body: z.object({}).strict(),
    audit: { exempt: 'StudentAccessService records students.portal_access_issued' },
    async handler({ params }) { return { status: 201, data: await studentAccess.issue(params.id) }; },
  });
  r.define({
    method: 'post', path: '/students/:id/portal-access/disable', summary: 'Disable a student login (sessions end at once)', tenancy: 'school', auth: 'session', permission: 'students:update', rateClass: 'sensitive',
    params: z.object({ id: objectIdSchema }).strict(), idParams: { id: 'student' }, body: z.object({}).strict(),
    audit: { exempt: 'StudentAccessService records students.portal_access_disabled' },
    async handler({ params }) { await studentAccess.setActive(params.id, false); return { status: 204 }; },
  });
  r.define({
    method: 'post', path: '/students/:id/portal-access/enable', summary: 'Re-enable a disabled student login', tenancy: 'school', auth: 'session', permission: 'students:update', rateClass: 'sensitive',
    params: z.object({ id: objectIdSchema }).strict(), idParams: { id: 'student' }, body: z.object({}).strict(),
    audit: { exempt: 'StudentAccessService records students.portal_access_enabled' },
    async handler({ params }) { await studentAccess.setActive(params.id, true); return { status: 204 }; },
  });

  r.define({
    method: 'post', path: '/students/:id/guardians/:linkId/portal-invite', summary: 'Invite a verified guardian to the parent portal (email)', tenancy: 'school', auth: 'session', permission: 'guardians:update', rateClass: 'sensitive',
    params: z.object({ id: objectIdSchema, linkId: objectIdSchema }).strict(), idParams: { id: 'student', linkId: 'guardian_link' }, body: z.object({}).strict(),
    audit: { exempt: 'ParentPortalService records parents.invited' },
    async handler({ params }) {
      return { status: 201, data: await parents.invite(params.id, params.linkId) };
    },
  });

  r.define({
    method: 'get', path: '/users', summary: 'List school members', tenancy: 'school', auth: 'session', permission: 'users:read',
    query: paginationQuerySchema,
    async handler({ query }) {
      const res = await svc.list(query.page, query.limit);
      return { data: res.data, meta: res.meta };
    },
  });

  r.define({
    method: 'post', path: '/users/invite', summary: 'Invite a staff member', tenancy: 'school', auth: 'session', permission: 'users:create', rateClass: 'sensitive',
    body: z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(254), phone: z.string().trim().max(20).optional(), roleKeys: z.array(z.string().min(1).max(60)).min(1).max(5), staffId: objectIdSchema.optional() }).strict(),
    audit: true,
    async handler({ body }) {
      const { membership } = await svc.invite(body);
      return { status: 201, data: { membershipId: String(membership._id), status: membership.status }, audit: { action: 'users.invited', entityType: 'membership', entityId: membership._id, after: { roleKeys: body.roleKeys } } };
    },
  });

  r.define({
    method: 'patch', path: '/users/:membershipId', summary: 'Change a member\'s roles or suspend/reactivate', tenancy: 'school', auth: 'session', permission: 'users:update', rateClass: 'sensitive',
    params: z.object({ membershipId: objectIdSchema }).strict(), idParams: { membershipId: 'membership' },
    body: z.object({ roleKeys: z.array(z.string().min(1).max(60)).min(1).max(5).optional(), status: z.enum(['active', 'suspended']).optional(), version: z.number().int().min(0).optional() }).strict().refine((b) => b.roleKeys || b.status, 'Nothing to change'),
    audit: { exempt: 'UsersService.update records users.membership_updated with before/after' },
    async handler({ params, body }) {
      const m = await svc.update(params.membershipId, { roleKeys: body.roleKeys, status: body.status }, body.version);
      return { data: { membershipId: String(m._id), roleKeys: m.roleKeys, status: m.status, version: m.__v } };
    },
  });

  r.define({
    method: 'get', path: '/roles', summary: 'List roles of the school', tenancy: 'school', auth: 'session', permission: 'users:read',
    async handler() {
      const rows = await roleRepository.listAll();
      return { data: rows.map((x) => ({ id: String(x._id), key: x.key, name: x.name, description: x.description, isSystem: x.isSystem, permissions: x.permissions })) };
    },
  });
}
