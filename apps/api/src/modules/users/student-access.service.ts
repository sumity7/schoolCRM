import type { Types } from 'mongoose';
import type { Env } from '../../config/env';
import { conflict, notFound } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import { requireTenant } from '../../core/tenancy/context';
import { authTokens, schools, users } from '../auth/auth.repository';
import { hashToken, newToken } from '../auth/crypto';
import type { SessionService } from '../auth/session.service';
import { membershipRepository } from '../memberships/memberships.repository';
import { studentRepo } from '../students/students.repository';
import type { IUser } from './user.model';

const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** `alpha-A1` in school `alpha` → `alpha-a1@alpha.student` (an e-mail-shaped login id; nothing is ever sent to it). */
export function studentLoginId(admissionNo: string, schoolCode: string): string {
  const slug = admissionNo.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'student';
  return `${slug}@${schoolCode.toLowerCase()}.student`;
}

/**
 * Student accounts. Students usually have no e-mail, so a staff member ISSUES one-time ACTIVATION access: the school
 * hands over a single-use link; the STUDENT chooses their own password through it. Staff never see or set a password.
 * "Reset" = issuing again (old password removed, every session revoked). Withdrawn/graduated students cannot use the
 * portal even if the account still exists (checked on every request in student-portal).
 */
export class StudentAccessService {
  constructor(private readonly deps: { env: Env; sessions: SessionService }) {}

  async issue(studentId: string) {
    const tenant = requireTenant('students.access.issue');
    const student = await studentRepo.getById(studentId, 'Student');
    if (student.status !== 'active') throw conflict('Only active students can have portal access');
    const school = await schools.findById(tenant.schoolId, 'student access: school');
    if (!school) throw notFound('School');
    const loginId = studentLoginId(student.admissionNo, school.code);

    let user = (await users.findOne({ email: loginId }, 'student access: lookup')) as (IUser & { _id: Types.ObjectId }) | null;
    const name = [student.firstName, student.lastName].filter(Boolean).join(' ');
    const existing = await membershipRepository.find({ personType: 'student', personId: student._id });
    if (!user) {
      user = (await users.create({ email: loginId, name, status: 'invited', failedLogins: 0 }, 'student access: create user')) as never;
    } else {
      const m = await membershipRepository.findOne({ userId: user._id });
      if (m && (m.personType !== 'student' || !m.personId?.equals(student._id))) throw conflict('This login id is already in use by another account');
      // reissue = reset: the old password stops working, MFA (if any) is cleared, locks are lifted
      await users.updateOne({ _id: user._id }, { $set: { passwordHash: null, status: 'invited', failedLogins: 0, lockedUntil: null, mfa: null, mfaPendingSecretEnc: null, name } }, 'student access: reset');
      await this.deps.sessions.revokeAllForUser(user._id);
      await authTokens.updateMany({ userId: user._id, usedAt: null }, { $set: { usedAt: new Date() } }, 'student access: void old activation links');
    }
    const membership = existing[0]
      ? await membershipRepository.updateById(existing[0]._id, { status: 'invited', roleKeys: ['student'], endedAt: null })
      : await membershipRepository.create({ userId: user!._id, roleKeys: ['student'], personType: 'student', personId: student._id, status: 'invited', invitedBy: tenant.membershipId });

    const token = newToken();
    const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS);
    await authTokens.create({ userId: user!._id, channel: 'email', destination: loginId, purpose: 'invite', tokenHash: hashToken(token), membershipId: membership._id, expiresAt }, 'student access: activation token');
    await AuditService.record({ action: 'students.portal_access_issued', entityType: 'student', entityId: student._id, after: { loginId, reissued: existing.length > 0 } });
    // The link is returned ONCE to the issuing staff member (it is not stored in plain text anywhere).
    return { loginId, activationUrl: `${this.deps.env.APP_BASE_URL}/accept-invite?token=${token}`, expiresAt };
  }

  async setActive(studentId: string, active: boolean) {
    const student = await studentRepo.getById(studentId, 'Student');
    const m = (await membershipRepository.find({ personType: 'student', personId: student._id }))[0];
    if (!m) throw notFound('Student account');
    if (active && m.status === 'invited') throw conflict('The student has not activated the account yet');
    await membershipRepository.updateById(m._id, { status: active ? 'active' : 'suspended' });
    if (!active) await this.deps.sessions.revokeForMembership(m._id);
    if (!active) await authTokens.updateMany({ userId: m.userId, usedAt: null, purpose: 'invite' }, { $set: { usedAt: new Date() } }, 'student access: void activation links on disable');
    await AuditService.record({ action: active ? 'students.portal_access_enabled' : 'students.portal_access_disabled', entityType: 'student', entityId: student._id });
  }

  async status(studentId: string) {
    const student = await studentRepo.getById(studentId, 'Student');
    const m = (await membershipRepository.find({ personType: 'student', personId: student._id }))[0];
    if (!m) return { exists: false as const };
    const user = (await users.findById(m.userId, 'student access: status user')) as (IUser & { lastLoginAt?: Date }) | null;
    return { exists: true as const, status: m.status, loginId: user?.email ?? null, lastLoginAt: user?.lastLoginAt ?? null };
  }
}
