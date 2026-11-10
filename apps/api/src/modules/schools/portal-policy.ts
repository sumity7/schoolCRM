import { DEFAULT_PORTAL_POLICY, type PortalPolicy } from './school.defaults';
import { getSchoolById } from './schools.service';
import { requireTenant } from '../../core/tenancy/context';

export async function getPortalPolicy(): Promise<PortalPolicy> {
  const t = requireTenant('portal.policy');
  const school = await getSchoolById(t.schoolId);
  return { ...DEFAULT_PORTAL_POLICY, ...(school.settings.portalPolicy ?? {}) };
}
