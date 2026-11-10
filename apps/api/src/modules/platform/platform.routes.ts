import { z } from 'zod';
import { addDays, objectIdSchema, paginationQuerySchema, todayInTz } from '@edunex/shared';
import type { Env } from '../../config/env';
import type { EmailAdapter } from '../../core/notifications/email';
import type { Registrar } from '../../core/http/route';
import { conflict, notFound } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { toObjectId } from '../../core/tenancy/repository';
import { schools } from '../auth/auth.repository';
import { provisionSchool } from '../schools/schools.service';
import { PlatformUsage } from './platform.repository';

/**
 * Super Admin web console (R5). Platform routes: super_admin only (support: read-only), MFA required (registrar).
 * School DATA is never shown here — only school records, usage COUNTS and the audit log.
 */
export function registerPlatformRoutes(r: Registrar, deps: { env: Env; email: EmailAdapter }) {
  r.define({
    method: 'get', path: '/platform/overview', summary: 'Platform totals (real counts)', tenancy: 'platform', auth: 'session', platformRoles: ['super_admin', 'support'],
    async handler() {
      const all = await schools.find({}, 'platform: overview schools');
      const [stu, staff, parents] = await Promise.all([PlatformUsage.activeStudents(), PlatformUsage.activeStaff(), PlatformUsage.parents()]);
      const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
      const byStatus: Record<string, number> = {};
      for (const s of all) byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
      return { data: { schools: all.length, byStatus, activeStudents: sum(stu), activeStaff: sum(staff), parentLogins: sum(parents) } };
    },
  });

  r.define({
    method: 'get', path: '/platform/schools', summary: 'All schools with usage against limits', tenancy: 'platform', auth: 'session', platformRoles: ['super_admin', 'support'],
    async handler() {
      const all = await schools.find({}, 'platform: list schools', { sort: { createdAt: -1 } });
      const since = addDays(todayInTz('Asia/Kolkata'), -30);
      const [stu, staff, parents, receipts] = await Promise.all([PlatformUsage.activeStudents(), PlatformUsage.activeStaff(), PlatformUsage.parents(), PlatformUsage.receiptsLast30Days(since)]);
      return {
        data: all.map((s) => ({
          id: String(s._id), name: s.name, code: s.code, status: s.status, limits: s.limits, createdAt: (s as unknown as { createdAt?: Date }).createdAt ?? null,
          owner: s.owner ? { name: s.owner.name, email: s.owner.email } : null,
          usage: { students: stu.get(String(s._id)) ?? 0, staff: staff.get(String(s._id)) ?? 0, parents: parents.get(String(s._id)) ?? 0, receipts30d: receipts.get(String(s._id)) ?? 0 },
        })),
      };
    },
  });

  r.define({
    method: 'post', path: '/platform/schools', summary: 'Create a school and invite its owner', tenancy: 'platform', auth: 'session',
    rateClass: 'sensitive',
    body: z.object({
      name: z.string().trim().min(2).max(160), code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/, '3–40 lowercase letters, digits or -'),
      ownerName: z.string().trim().min(1).max(120), ownerEmail: z.string().trim().email().max(254),
      limits: z.object({ students: z.number().int().min(1).max(100_000), staff: z.number().int().min(1).max(5_000) }).strict().optional(),
    }).strict(),
    audit: { exempt: 'provisionSchool records platform.school_provisioned' },
    async handler({ body, auth }) {
      const res = await provisionSchool(
        { name: body.name, code: body.code, owner: { name: body.ownerName, email: body.ownerEmail }, limits: body.limits },
        { email: deps.email, appBaseUrl: deps.env.APP_BASE_URL, actorUserId: auth.user._id },
      );
      return { status: 201, data: { id: String(res.school._id), code: res.school.code, ownerInvited: true } };
    },
  });

  r.define({
    method: 'patch', path: '/platform/schools/:id', summary: 'Change a school\'s status or plan limits', tenancy: 'platform', auth: 'session',
    rateClass: 'sensitive', params: z.object({ id: objectIdSchema }).strict(),
    body: z.object({
      status: z.enum(['onboarding', 'live', 'suspended', 'deactivated']).optional(),
      limits: z.object({ students: z.number().int().min(1).max(100_000), staff: z.number().int().min(1).max(5_000) }).strict().optional(),
      reason: z.string().trim().min(3).max(300),
    }).strict().refine((b) => b.status || b.limits, 'Nothing to change'),
    audit: { exempt: 'Handler records platform.school_updated with before/after' },
    async handler({ params, body, auth }) {
      const id = toObjectId(params.id)!;
      const before = await schools.findOne({ _id: id }, 'platform: school before update');
      if (!before) throw notFound('School');
      if (body.limits && body.status === 'deactivated') throw conflict('Change limits and deactivate in separate steps');
      const set: Record<string, unknown> = {};
      if (body.status) set.status = body.status;
      if (body.limits) set.limits = body.limits;
      const after = await schools.findOneAndUpdate({ _id: id }, { $set: set }, 'platform: update school');
      await AuditService.record({ action: 'platform.school_updated', entityType: 'school', entityId: id, actorUserId: auth.user._id, schoolId: null, before: { status: before.status, limits: before.limits }, after: { ...set, reason: body.reason } });
      return { data: { id: params.id, status: after!.status, limits: after!.limits } };
    },
  });

  r.define({
    method: 'get', path: '/platform/audit', summary: 'Platform-wide audit log', tenancy: 'platform', auth: 'session', platformRoles: ['super_admin', 'support'],
    query: paginationQuerySchema.extend({ schoolId: objectIdSchema.optional() }).strict(),
    async handler({ query }) {
      const res = await AuditService.listPlatform(query);
      return { data: res.data.map((a) => ({ id: String(a._id), at: a.at, action: a.action, schoolId: a.schoolId ? String(a.schoolId) : null, entityType: a.entityType, actorUserId: a.actorUserId ? String(a.actorUserId) : null, requestId: a.requestId })), meta: res.meta };
    },
  });
}
