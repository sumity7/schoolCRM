import { createHash } from 'node:crypto';
import { AppError, conflict } from '../errors';
import { requireTenant } from '../tenancy/context';
import { IdempotencyKeyModel } from './idempotency.model';

export function hashRequest(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/**
 * At-most-once execution per (school, key, route):
 *  - first call executes `fn` and stores the response;
 *  - same key + same body → replays the stored response (no second execution);
 *  - same key + different body → 422 IDEMPOTENCY_MISMATCH;
 *  - same key while the first is still running → 409.
 * Callers still need their own business-level uniqueness (e.g. unique indexes) as the final guard.
 */
export async function runIdempotent<T>(
  key: string | undefined,
  route: string,
  requestBody: unknown,
  fn: () => Promise<{ status: number; body: T }>,
): Promise<IdempotentResult<T>> {
  if (!key || key.length < 8 || key.length > 120) {
    throw new AppError(400, 'VALIDATION_FAILED', 'Idempotency-Key header (8–120 chars) is required for this request');
  }
  const t = requireTenant('idempotency');
  const requestHash = hashRequest(requestBody);

  try {
    await IdempotencyKeyModel.create({ schoolId: t.schoolId, key, route, requestHash, state: 'in_progress' });
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    const existing = await IdempotencyKeyModel.findOne({ key, route }).lean();
    if (!existing) throw conflict('Request is being processed, retry shortly');
    if (existing.requestHash !== requestHash) {
      throw new AppError(422, 'IDEMPOTENCY_MISMATCH', 'This Idempotency-Key was already used with a different request');
    }
    if (existing.state === 'done') {
      return { status: existing.responseStatus ?? 200, body: existing.responseBody as T, replayed: true };
    }
    throw conflict('A request with this Idempotency-Key is still being processed');
  }

  try {
    const result = await fn();
    await IdempotencyKeyModel.updateOne({ key, route }, { $set: { state: 'done', responseStatus: result.status, responseBody: result.body } });
    return { ...result, replayed: false };
  } catch (err) {
    // Failed executions release the key so the client may retry with the same key.
    await IdempotencyKeyModel.deleteOne({ key, route, state: 'in_progress' }).catch(() => undefined);
    throw err;
  }
}
