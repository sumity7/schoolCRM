import { TenantRepository } from '../../core/tenancy/repository';
import { StaffModel, type IStaff } from './staff.model';

export class StaffRepository extends TenantRepository<IStaff> {
  constructor() { super(StaffModel); }
}
export const staffRepo = new StaffRepository();
