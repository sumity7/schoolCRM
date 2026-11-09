import type { Types } from 'mongoose';
import { defineTenantModel } from '../../core/tenancy/registry';

export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'ended';
export type PersonType = 'staff' | 'guardian' | 'student' | 'owner';

export interface IMembership {
  userId: Types.ObjectId;
  roleKeys: string[];
  status: MembershipStatus;
  personType: PersonType;
  personId?: Types.ObjectId;
  invitedBy?: Types.ObjectId;
  endedAt?: Date | null;
}

/**
 * A user's membership of ONE school with one or more roles. Tenant-owned.
 * Login resolves "which schools am I in?" via PlatformRepository (the single audited cross-tenant read).
 */
export const MembershipModel = defineTenantModel<IMembership>(
  'Membership',
  {
    userId: { type: 'ObjectId', required: true, ref: 'User' },
    roleKeys: { type: [String], required: true, validate: (v: string[]) => v.length >= 1 && v.length <= 10 },
    status: { type: String, enum: ['invited', 'active', 'suspended', 'ended'], default: 'invited', required: true },
    personType: { type: String, enum: ['staff', 'guardian', 'student', 'owner'], required: true },
    personId: { type: 'ObjectId' },
    invitedBy: { type: 'ObjectId' },
    endedAt: { type: Date, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, userId: 1 }, { unique: true });
    s.index({ userId: 1, status: 1 });
    s.index({ schoolId: 1, personType: 1, personId: 1 });
    s.index({ schoolId: 1, status: 1 });
  },
);
