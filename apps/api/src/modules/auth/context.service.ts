import type { Types } from 'mongoose';
import { resolveGrants, type PermissionGrant, type PermissionKey } from '@edunex/shared';
import type { TenantContext } from '../../core/tenancy/context';
import { memberships, roles, schools } from './auth.repository';
import type { ISchool } from '../schools/school.model';
import type { IUser } from '../users/user.model';

/** School statuses in which staff may operate. Suspended/deactivated schools lose access (policy D-10 refines later). */
export const ACTIVE_SCHOOL_STATUSES = ['onboarding', 'live'];

export interface ResolvedContext {
  tenant: TenantContext;
  school: ISchool & { _id: Types.ObjectId };
}

/**
 * Builds the TenantContext from the SERVER-SIDE session → membership → roles chain (doc 06, lock 1).
 * Re-read from the database on every request: permission/role/status changes take effect immediately.
 */
export async function resolveTenantContext(user: IUser & { _id: Types.ObjectId }, activeMembershipId: Types.ObjectId | null | undefined): Promise<ResolvedContext | null> {
  if (!activeMembershipId) return null;
  const m = await memberships.findOne({ _id: activeMembershipId, userId: user._id, status: 'active' }, 'auth: resolve membership');
  if (!m) return null;
  const school = await schools.findById((m as unknown as { schoolId: Types.ObjectId }).schoolId, 'auth: resolve school');
  if (!school || !ACTIVE_SCHOOL_STATUSES.includes(school.status)) return null;
  const roleRows = await roles.find({ schoolId: school._id, key: { $in: m.roleKeys } }, 'auth: resolve roles');
  const grants = resolveGrants(roleRows.flatMap((r) => r.permissions as PermissionGrant[]));
  const tenant: TenantContext = {
    schoolId: school._id,
    membershipId: m._id,
    userId: user._id,
    roleKeys: m.roleKeys,
    grants: grants as Map<PermissionKey, import('@edunex/shared').Scope>,
    personType: m.personType,
    personId: m.personId,
  };
  return { tenant, school: school as ResolvedContext['school'] };
}
