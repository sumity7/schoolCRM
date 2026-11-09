import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { runWithTenant } from './tenancy/context';
import { SequenceService, formatSequence } from './sequences/sequence.service';
import { runIdempotent } from './idempotency/idempotency.service';
import { redactForAudit } from './audit/audit.service';
import { withTransaction } from './db/connection';
import { loadEnv } from '../config/env';
import { setupTestDb, teardownTestDb, clearAll } from '../../test/helpers/db';
import { makeCtx } from '../../test/helpers/tenant';
import { makeTestApp, TEST_ORIGIN } from '../../test/helpers/app';

const A = makeCtx();
const B = makeCtx();

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(clearAll);

describe('REQ-FEE-sequence — per-school atomic sequences', () => {
  it('50 concurrent allocations produce 50 unique, gap-free numbers; schools are independent', async () => {
    const nums = await runWithTenant(A, () => Promise.all(Array.from({ length: 50 }, () => SequenceService.next('receipt:2026-27'))));
    expect([...nums].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(nums).size).toBe(50);
    expect(await runWithTenant(B, () => SequenceService.next('receipt:2026-27'))).toBe(1);
    expect(await runWithTenant(A, () => SequenceService.peek('receipt:2026-27'))).toBe(50);
  });
  it('a rolled-back transaction also rolls back the increment (no gaps from failed payments)', async () => {
    await runWithTenant(A, () => SequenceService.next('r')); // 1
    await expect(
      runWithTenant(A, () =>
        withTransaction(async () => {
          expect(await SequenceService.next('r')).toBe(2);
          throw new Error('payment failed');
        }),
      ),
    ).rejects.toThrow('payment failed');
    expect(await runWithTenant(A, () => SequenceService.next('r'))).toBe(2);
  });
  it('formats receipt-style numbers', () => {
    expect(formatSequence('SCH', '2026-27', 123)).toBe('SCH/2026-27/000123');
  });
});

describe('REQ-IDEMP — idempotent execution', () => {
  it('replays the stored response for the same key + body and executes once', async () => {
    let runs = 0;
    const fn = async () => ({ status: 201, body: { n: ++runs } });
    const first = await runWithTenant(A, () => runIdempotent('key-123456', 'POST /payments', { amount: 100 }, fn));
    const second = await runWithTenant(A, () => runIdempotent('key-123456', 'POST /payments', { amount: 100 }, fn));
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.body).toEqual({ n: 1 });
    expect(runs).toBe(1);
  });
  it('same key with a different body → 422 IDEMPOTENCY_MISMATCH', async () => {
    await runWithTenant(A, () => runIdempotent('key-abcdef', 'r', { a: 1 }, async () => ({ status: 200, body: 1 })));
    await expect(runWithTenant(A, () => runIdempotent('key-abcdef', 'r', { a: 2 }, async () => ({ status: 200, body: 2 })))).rejects.toMatchObject({ status: 422, code: 'IDEMPOTENCY_MISMATCH' });
  });
  it('10 concurrent identical requests execute the business function exactly once', async () => {
    let runs = 0;
    const slow = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 80));
      return { status: 200, body: { ok: true } };
    };
    const results = await runWithTenant(A, () => Promise.allSettled(Array.from({ length: 10 }, () => runIdempotent('concurrent-key-1', 'r', { x: 1 }, slow))));
    expect(runs).toBe(1);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) expect(r.reason.status).toBe(409); // "still processing"
    const again = await runWithTenant(A, () => runIdempotent('concurrent-key-1', 'r', { x: 1 }, slow));
    expect(again.replayed).toBe(true);
    expect(runs).toBe(1);
  });
  it('a failed execution releases the key so the client can retry', async () => {
    await expect(runWithTenant(A, () => runIdempotent('retry-key-01', 'r', {}, async () => { throw new Error('boom'); }))).rejects.toThrow('boom');
    const ok = await runWithTenant(A, () => runIdempotent('retry-key-01', 'r', {}, async () => ({ status: 200, body: 'fine' })));
    expect(ok.replayed).toBe(false);
  });
  it('keys are scoped per school and required', async () => {
    let runs = 0;
    const fn = async () => ({ status: 200, body: ++runs });
    await runWithTenant(A, () => runIdempotent('shared-key-1', 'r', {}, fn));
    await runWithTenant(B, () => runIdempotent('shared-key-1', 'r', {}, fn));
    expect(runs).toBe(2);
    await expect(runWithTenant(A, () => runIdempotent(undefined, 'r', {}, fn))).rejects.toMatchObject({ status: 400 });
  });
});

describe('REQ-AUD redaction', () => {
  it('redacts credential-like keys deeply and truncates huge strings', () => {
    const out = redactForAudit({ name: 'x', password: 'p', nested: { tokenHash: 'h', arr: [{ secret: 's' }] }, long: 'a'.repeat(900) }) as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toMatch(/"p"|"h"|"s"/);
    expect((out.long as string).length).toBeLessThan(600);
    expect((out.nested as { tokenHash: string }).tokenHash).toBe('[REDACTED]');
  });
});

describe('REQ-SEC rate limiting', () => {
  it('429s repeated login attempts from one IP once the limit is hit', async () => {
    const t = makeTestApp({ RATE_LIMIT_ENABLED: 'true' }, { auth: { windowMs: 60_000, limit: 3 } });
    const hit = () => request(t.app).post('/api/v1/auth/login').set('Origin', TEST_ORIGIN).set('X-Requested-With', 'edunex').send({ identifier: 'a@b.test', password: 'whatever-1' });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await hit()).status);
    expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });
});

describe('env validation (fail fast)', () => {
  it('refuses insecure production configuration', () => {
    expect(() => loadEnv({ NODE_ENV: 'production', COOKIE_SECURE: 'false', DATABASE_URL: 'mongodb+srv://x' } as NodeJS.ProcessEnv)).toThrow(/COOKIE_SECURE/);
    expect(() => loadEnv({ NODE_ENV: 'production', COOKIE_SECURE: 'true', DATABASE_URL: 'mongodb://localhost/x' } as NodeJS.ProcessEnv)).toThrow(/localhost/);
    expect(() => loadEnv({ NODE_ENV: 'production', COOKIE_SECURE: 'true', DATABASE_URL: 'mongodb+srv://x', FEATURE_ONLINE_PAYMENTS: 'true' } as NodeJS.ProcessEnv)).toThrow(/Paid/);
  });
  it('rejects invalid values and keeps paid integrations off by default', () => {
    expect(() => loadEnv({ PORT: 'abc' } as NodeJS.ProcessEnv)).toThrow(/PORT/);
    const env = loadEnv({} as NodeJS.ProcessEnv);
    expect([env.FEATURE_ONLINE_PAYMENTS, env.FEATURE_SMS, env.FEATURE_WHATSAPP]).toEqual([false, false, false]);
  });
});
