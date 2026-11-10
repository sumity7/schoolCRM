import { z } from 'zod';
import { objectIdSchema, paginationQuerySchema } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { NoticesService, toNoticeDto } from './notices.service';

const idParam = z.object({ id: objectIdSchema }).strict();

export function registerNoticeRoutes(r: Registrar) {
  r.define({
    method: 'get', path: '/notices', summary: 'Notices I can see (with read state and unread count)', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'notices:read',
    query: paginationQuerySchema.strict(),
    async handler({ query, scope, tenant }) {
      const res = await NoticesService.list(scope, tenant.grants.get('notices:create') === 'school', query.page, query.limit);
      return { data: res.data, meta: { ...res.meta, unread: res.unread } as never };
    },
  });
  r.define({
    method: 'post', path: '/notices', summary: 'Publish a notice (teachers: own classes only)', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'notices:create',
    body: z.object({
      title: z.string().trim().min(3).max(150), body: z.string().trim().min(1).max(5000),
      audience: z.enum(['everyone', 'staff', 'parents', 'sections']), sectionIds: z.array(objectIdSchema).max(100).optional(), emailParents: z.boolean().optional(),
    }).strict(),
    audit: { exempt: 'NoticesService records notices.published' },
    async handler({ body, scope, auth }) {
      return { status: 201, data: toNoticeDto(await NoticesService.create(scope, body, auth.user.name)) };
    },
  });
  r.define({
    method: 'post', path: '/notices/:id/read', summary: 'Mark a notice as read', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'notices:read',
    params: idParam, idParams: { id: 'notice' }, body: z.object({}).strict(),
    audit: { exempt: 'Read receipts are data, not changes to school records' },
    async handler({ params, scope, tenant }) {
      await NoticesService.markRead(params.id, scope, tenant.grants.get('notices:create') === 'school');
      return { status: 204 };
    },
  });
  r.define({
    method: 'post', path: '/notices/:id/withdraw', summary: 'Withdraw a notice (author or administrator)', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'notices:create',
    params: idParam, idParams: { id: 'notice' }, body: z.object({}).strict(),
    audit: { exempt: 'NoticesService records notices.withdrawn' },
    async handler({ params, tenant }) {
      return { data: toNoticeDto(await NoticesService.withdraw(params.id, tenant.grants.get('notices:create'))) };
    },
  });
  r.define({
    method: 'get', path: '/notices/:id/stats', summary: 'Read count and email deliveries of a notice', tenancy: 'school', auth: 'session', allowOwnScope: true, permission: 'notices:create',
    params: idParam, idParams: { id: 'notice' },
    async handler({ params, scope, tenant }) {
      await NoticesService.getVisible(params.id, scope, tenant.grants.get('notices:create') === 'school');
      return { data: await NoticesService.stats(params.id) };
    },
  });
}
