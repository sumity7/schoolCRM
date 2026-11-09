import { Types } from 'mongoose';
import type { PermissionKey, Scope } from '@edunex/shared';
import type { TenantContext } from '../../src/core/tenancy/context';

export function makeCtx(schoolId: Types.ObjectId = new Types.ObjectId(), extra: Partial<TenantContext> = {}): TenantContext {
  return {
    schoolId,
    membershipId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    roleKeys: ['owner'],
    grants: new Map<PermissionKey, Scope>(),
    ...extra,
  };
}
