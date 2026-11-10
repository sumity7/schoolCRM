import type { Types } from 'mongoose';
import { forbidden, notFound } from '../../core/errors';
import { requireTenant } from '../../core/tenancy/context';
import { toObjectId } from '../../core/tenancy/repository';
import { studentGuardianRepo } from '../students/students.repository';

/**
 * THE parent access rule (doc 06, acceptance scenario 2): a parent sees a child only through a guardian link that is
 * VERIFIED, has PORTAL ACCESS and has NOT ENDED. It is evaluated on every request, so turning portal access off or
 * ending the link (e.g. a custody order) takes effect immediately — no session or membership change needed.
 */
export interface ChildLink { studentId: Types.ObjectId; linkId: Types.ObjectId; canViewFees: boolean; relationship: string }

function guardianIdOf(): Types.ObjectId {
  const t = requireTenant('parent.access');
  if (t.personType !== 'guardian' || !t.personId) throw forbidden('This area is for parents and guardians');
  return t.personId;
}

export async function linkedChildren(): Promise<ChildLink[]> {
  const guardianId = guardianIdOf();
  const links = await studentGuardianRepo.find({ guardianId, portalAccess: true, verifiedAt: { $ne: null }, endedAt: null });
  return links.map((l) => ({ studentId: l.studentId, linkId: l._id, canViewFees: l.canViewFees, relationship: l.relationship }));
}

/** 404 (not 403) for any child that is not linked — indistinguishable from "does not exist". */
export async function assertChild(studentId: string): Promise<ChildLink> {
  const sid = toObjectId(studentId);
  const link = sid ? (await linkedChildren()).find((c) => c.studentId.equals(sid)) : undefined;
  if (!link) throw notFound('Student');
  return link;
}

export function isGuardian(): boolean {
  const t = requireTenant('parent.isGuardian');
  return t.personType === 'guardian' && Boolean(t.personId);
}
