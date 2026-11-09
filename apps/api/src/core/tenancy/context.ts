import { AsyncLocalStorage } from 'node:async_hooks';
import type { Types } from 'mongoose';
import type { PermissionKey, Scope } from '@edunex/shared';
import { TenantContextMissingError } from '../errors';

/**
 * TenantContext is the ONLY source of `schoolId` for school-scoped work (doc 06, lock 1).
 * It is built from the server-side session → membership, never from request payloads.
 */
export interface TenantContext {
  schoolId: Types.ObjectId;
  membershipId: Types.ObjectId;
  userId: Types.ObjectId;
  roleKeys: string[];
  grants: Map<PermissionKey, Scope>;
  personType?: string;
  personId?: Types.ObjectId;
  /** True for audited break-glass support sessions: all writes are refused. */
  readOnly?: boolean;
}

interface Store {
  tenant?: TenantContext;
  /** Explicit, reasoned cross-tenant access (PlatformRepository / auth lookups only). */
  platform?: { reason: string };
}

const als = new AsyncLocalStorage<Store>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return als.run({ tenant: ctx }, fn);
}

/**
 * Runs `fn` with tenant scoping deliberately lifted. Lint restricts importers of this
 * module to `modules/platform`, `modules/auth` and `core/tenancy` (see eslint.config.js).
 */
export function runAsPlatform<T>(reason: string, fn: () => T): T {
  if (!reason || reason.length < 3) throw new Error('runAsPlatform requires a reason');
  return als.run({ platform: { reason } }, fn);
}

export function getStore(): Store | undefined {
  return als.getStore();
}

export function currentTenant(): TenantContext | undefined {
  return als.getStore()?.tenant;
}

export function requireTenant(op = 'operation'): TenantContext {
  const t = als.getStore()?.tenant;
  if (!t) throw new TenantContextMissingError(op);
  return t;
}

export function isPlatformBypass(): boolean {
  return Boolean(als.getStore()?.platform);
}
