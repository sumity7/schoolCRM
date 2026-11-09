import { TenantRepository } from '../../core/tenancy/repository';
import { RoleModel, type IRole } from './role.model';

export class RoleRepository extends TenantRepository<IRole> {
  constructor() {
    super(RoleModel);
  }
  listAll() {
    return this.find({}, { sort: { key: 1 } });
  }
  byKeys(keys: string[]) {
    return this.find({ key: { $in: keys } });
  }
}

export const roleRepository = new RoleRepository();
