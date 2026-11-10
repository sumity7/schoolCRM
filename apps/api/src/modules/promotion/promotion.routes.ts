import { z } from 'zod';
import { objectIdSchema } from '@edunex/shared';
import type { Registrar } from '../../core/http/route';
import { runIdempotent } from '../../core/idempotency/idempotency.service';
import { sessionRepo } from '../academics/academics.repository';
import { PromotionService } from './promotion.service';

export function registerPromotionRoutes(r: Registrar) {
  r.define({
    method: 'post', path: '/promotions/prepare', summary: 'Copy classes/sections (and optionally fee structures) into the next session', tenancy: 'school', auth: 'session', permission: 'academics:approve',
    body: z.object({ targetSessionId: objectIdSchema, copyFeeStructures: z.boolean().optional() }).strict(),
    audit: { exempt: 'PromotionService records promotion.prepared' },
    async handler({ body }) { return { data: await PromotionService.prepare(body.targetSessionId, { copyFeeStructures: body.copyFeeStructures }) }; },
  });
  r.define({
    method: 'get', path: '/promotions/preview', summary: 'Per-class promotion plan with suggested actions', tenancy: 'school', auth: 'session', permission: 'academics:approve',
    query: z.object({ targetSessionId: objectIdSchema }).strict(),
    async handler({ query }) { return { data: await PromotionService.preview(query.targetSessionId) }; },
  });
  r.define({
    method: 'post', path: '/promotions/commit', summary: 'Save promotion decisions (Idempotency-Key; applied when the new session is activated)', tenancy: 'school', auth: 'session', permission: 'academics:approve',
    rateClass: 'sensitive',
    body: z.object({
      targetSessionId: objectIdSchema,
      decisions: z.array(z.object({ studentId: objectIdSchema, action: z.enum(['promote', 'retain', 'graduate']), sectionId: objectIdSchema.nullable().optional() }).strict()).min(1).max(3000),
    }).strict(),
    audit: { exempt: 'PromotionService records promotion.decisions_saved' },
    async handler({ body, req }) {
      await sessionRepo.getById(body.targetSessionId, 'Session'); // 404 for other schools' sessions first
      const out = await runIdempotent(req.get('Idempotency-Key'), 'promotion.commit', body, async () => ({ status: 200, body: await PromotionService.commit(body.targetSessionId, body.decisions) }));
      return { status: out.status, data: out.body };
    },
  });
}
