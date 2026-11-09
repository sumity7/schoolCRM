import type { Types } from 'mongoose';
import { TenantRepository } from '../../core/tenancy/repository';
import { MembershipModel, type IMembership } from './membership.model';

export class MembershipRepository extends TenantRepository<IMembership> {
  constructor() {
    super(MembershipModel);
  }
  findByUser(userId: Types.ObjectId) {
    return this.findOne({ userId });
  }
  async countActiveOwners(): Promise<number> {
    return this.count({ roleKeys: 'owner', status: { $in: ['active', 'invited'] } });
  }
  countStaff(): Promise<number> {
    return this.count({ personType: { $in: ['staff', 'owner'] }, status: { $in: ['active', 'invited'] } });
  }
}

export const membershipRepository = new MembershipRepository();
