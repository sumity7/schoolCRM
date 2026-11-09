import { Types } from 'mongoose';
import { PlatformRepository } from '../tenancy/platform-repository';
import { currentTenant } from '../tenancy/context';
import { currentRequestMeta } from '../http/request-context';
import { AuditLogModel, type IAuditLog } from './audit-log.model';
import { toObjectId } from '../tenancy/repository';
import { requireTenant } from '../tenancy/context';
import { runAsPlatform } from '../tenancy/context';

const REDACT_KEYS = new Set([
  'password', 'newpassword', 'currentpassword', 'passwordhash', 'token', 'tokenhash', 'secret', 'secretenc', 'authorization', 'cookie', 'mfa', 'otp',
]);
const MAX_DEPTH = 5;
const MAX_STRING = 500;

/** Deep-redacts credential-like keys and caps size so audit rows never leak secrets or bloat. */
export function redactForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value instanceof Date) return value;
  if (value instanceof Types.ObjectId) return value.toHexString();
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactForAudit(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? '[REDACTED]' : redactForAudit(v, depth + 1);
  }
  return out;
}

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: unknown;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  /** Override actor/school (e.g. login before a tenant context exists, platform CLI events). */
  actorUserId?: Types.ObjectId | null;
  schoolId?: Types.ObjectId | null;
}

const repo = new PlatformRepository<IAuditLog>(AuditLogModel);

/** Append-only audit writer. There is intentionally no update/delete API. */
export const AuditService = {
  async record(entry: AuditEntry): Promise<void> {
    const tenant = currentTenant();
    const meta = currentRequestMeta();
    await repo.create(
      {
        schoolId: entry.schoolId !== undefined ? entry.schoolId : (tenant?.schoolId ?? null),
        actorUserId: entry.actorUserId !== undefined ? entry.actorUserId : (tenant?.userId ?? null),
        actorMembershipId: tenant?.membershipId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId === undefined || entry.entityId === null ? undefined : String(entry.entityId),
        before: redactForAudit(entry.before),
        after: redactForAudit(entry.after),
        meta: redactForAudit(entry.meta),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
        requestId: meta?.requestId,
        at: new Date(),
      },
      'audit: append',
    );
  },

  /** School-scoped read: ALWAYS filtered by the current tenant (never a caller-supplied school). */
  async listForCurrentSchool(opts: { page: number; limit: number; entityType?: string; entityId?: string; action?: string; actorUserId?: string }) {
    const t = requireTenant('audit.list');
    const filter: Record<string, unknown> = { schoolId: t.schoolId };
    if (opts.entityType) filter.entityType = opts.entityType;
    if (opts.entityId) filter.entityId = opts.entityId;
    if (opts.action) filter.action = opts.action;
    const actor = toObjectId(opts.actorUserId);
    if (actor) filter.actorUserId = actor;
    const [total, data] = await Promise.all([
      repo.count(filter, 'audit: list count (school scoped)'),
      repo.find(filter, 'audit: list (school scoped)', { sort: { at: -1 }, skip: (opts.page - 1) * opts.limit, limit: opts.limit }),
    ]);
    return { data, meta: { page: opts.page, limit: opts.limit, total, totalPages: Math.max(1, Math.ceil(total / opts.limit)) } };
  },

  /** Platform-wide read (Super Admin only; callers enforce the platform role). */
  async listPlatform(opts: { page: number; limit: number; schoolId?: string }) {
    const filter: Record<string, unknown> = {};
    const sid = toObjectId(opts.schoolId);
    if (sid) filter.schoolId = sid;
    const [total, data] = await Promise.all([
      repo.count(filter, 'audit: platform list count'),
      repo.find(filter, 'audit: platform list', { sort: { at: -1 }, skip: (opts.page - 1) * opts.limit, limit: opts.limit }),
    ]);
    return { data, meta: { page: opts.page, limit: opts.limit, total, totalPages: Math.max(1, Math.ceil(total / opts.limit)) } };
  },
};

// kept for tests that need to assert on raw rows
export async function _auditRowsForTest(filter: Record<string, unknown> = {}) {
  return runAsPlatform('test: read audit rows', () => AuditLogModel.find(filter as never).sort({ at: 1 }).lean());
}
