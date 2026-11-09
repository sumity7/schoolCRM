import { z } from 'zod';
import { paginationQuerySchema } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { AuditService } from '../../core/audit/audit.service';

export function registerAuditRoutes(r: Registrar) {
  r.define({
    method: 'get', path: '/audit-logs', summary: 'School audit log (own school only)', tenancy: 'school', auth: 'session', permission: 'audit:read',
    query: paginationQuerySchema.extend({
      entityType: z.string().max(60).optional(),
      entityId: z.string().max(60).optional(),
      action: z.string().max(80).optional(),
      actorUserId: z.string().max(24).optional(),
    }).strict(),
    async handler({ query }) {
      const res = await AuditService.listForCurrentSchool(query);
      return {
        data: res.data.map((a) => ({ id: String(a._id), at: a.at, action: a.action, entityType: a.entityType, entityId: a.entityId, actorUserId: a.actorUserId ? String(a.actorUserId) : null, before: a.before, after: a.after, requestId: a.requestId })),
        meta: res.meta,
      };
    },
  });
}
