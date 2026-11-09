import { conflict, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { requireTenant } from '../../core/tenancy/context';
import { isValidDay } from '@edunex/shared';
import { membershipRepository } from '../memberships/memberships.repository';
import { staffRepo } from './staff.repository';
import { entitlementRequired } from '../../core/errors';
import { getSchoolById } from '../schools/schools.service';

export interface StaffInput {
  employeeId: string;
  name: string;
  phone?: string;
  email?: string;
  designation: string;
  department?: string;
  kind: 'teaching' | 'non_teaching';
  joiningDate?: string;
}

export const StaffService = {
  async create(input: StaffInput) {
    if (input.joiningDate && !isValidDay(input.joiningDate)) throw validationFailed('Invalid joining date');
    const t = requireTenant('staff.create');
    const school = await getSchoolById(t.schoolId);
    if ((await staffRepo.count({ status: { $in: ['active', 'on_leave'] } })) >= school.limits.staff) {
      throw entitlementRequired('Staff limit for your plan has been reached');
    }
    if (await staffRepo.exists({ employeeId: input.employeeId })) throw conflict('Employee ID already exists');
    const s = await staffRepo.create({ ...input, status: 'active' });
    await AuditService.record({ action: 'staff.created', entityType: 'staff', entityId: s._id, after: { employeeId: s.employeeId, name: s.name } });
    return s;
  },

  async setStatus(id: string, status: 'active' | 'on_leave' | 'resigned' | 'terminated', endDate?: string) {
    const s = await staffRepo.getById(id, 'Staff member');
    if (endDate && !isValidDay(endDate)) throw validationFailed('Invalid end date');
    if ((status === 'resigned' || status === 'terminated') && !endDate) throw validationFailed('An end date is required');
    const updated = await staffRepo.updateById(id, { status, ...(endDate ? { endDate } : {}) }, { what: 'Staff member' });
    if (status === 'resigned' || status === 'terminated') {
      // access ends with employment; history (assignments, attendance, audit) is preserved
      const m = await membershipRepository.findOne({ personType: 'staff', personId: s._id });
      if (m) await membershipRepository.updateById(m._id, { status: 'ended', endedAt: new Date() });
    }
    await AuditService.record({ action: 'staff.status_changed', entityType: 'staff', entityId: id, before: { status: s.status }, after: { status, endDate } });
    return updated;
  },
};
