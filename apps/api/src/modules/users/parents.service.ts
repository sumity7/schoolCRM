import type { Types } from 'mongoose';
import type { Env } from '../../config/env';
import { conflict, notFound, validationFailed } from '../../core/errors';
import type { EmailAdapter } from '../../core/notifications/email';
import { requireTenant } from '../../core/tenancy/context';
import { AuditService } from '../../core/audit/audit.service';
import { authTokens, schools, users } from '../auth/auth.repository';
import { hashToken, newToken } from '../auth/crypto';
import { membershipRepository } from '../memberships/memberships.repository';
import { guardianRepo, studentGuardianRepo, studentRepo } from '../students/students.repository';
import type { IUser } from './user.model';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Parent portal access (D-03 default, decided under the 2026-11-10 autonomous directive): parents sign in with
 * EMAIL + PASSWORD via a single-use invitation, sent only for a guardian link that the school has VERIFIED and for
 * which PORTAL ACCESS is on. One login per guardian per school, shared by all their linked children (siblings).
 * Phone-only parents cannot be invited yet (no SMS adapter — D-28).
 */
export class ParentPortalService {
  constructor(private readonly deps: { env: Env; email: EmailAdapter }) {}

  async invite(studentId: string, linkId: string) {
    const tenant = requireTenant('parents.invite');
    const student = await studentRepo.getById(studentId, 'Student');
    const link = await studentGuardianRepo.getById(linkId, 'Guardian link');
    if (!link.studentId.equals(student._id)) throw notFound('Guardian link');
    if (link.endedAt) throw conflict('This guardian link has ended');
    if (!link.verifiedAt) throw conflict('Verify the guardian first');
    if (!link.portalAccess) throw conflict('Turn on portal access for this guardian first');
    const guardian = await guardianRepo.getById(link.guardianId, 'Guardian');
    const email = guardian.email?.trim().toLowerCase();
    if (!email) throw validationFailed('Add an email address for this guardian — invitations are sent by email');

    let user = (await users.findOne({ email }, 'parents: invite lookup')) as (IUser & { _id: Types.ObjectId }) | null;
    if (!user) user = (await users.create({ email, name: guardian.name, status: 'invited', failedLogins: 0 }, 'parents: create invited user')) as never;
    const existing = await membershipRepository.findOne({ userId: user!._id });
    if (existing && existing.personType !== 'guardian') throw conflict('This email already belongs to a staff account of your school. Use a different email for the parent login.');
    if (existing && existing.personId && !existing.personId.equals(guardian._id)) throw conflict('This email is already used by another guardian of your school');
    if (existing && existing.status === 'active') throw conflict('This guardian already has portal access');
    const membership = existing
      ? await membershipRepository.updateById(existing._id, { status: 'invited', roleKeys: ['parent'], endedAt: null })
      : await membershipRepository.create({ userId: user!._id, roleKeys: ['parent'], personType: 'guardian', personId: guardian._id, status: 'invited', invitedBy: tenant.membershipId });
    await guardianRepo.updateById(guardian._id, { userId: user!._id });

    const token = newToken();
    await authTokens.create(
      { userId: user!._id, channel: 'email', destination: email, purpose: 'invite', tokenHash: hashToken(token), membershipId: membership._id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      'parents: invite token',
    );
    const school = await schools.findById(tenant.schoolId, 'parents: school name');
    await this.deps.email.send({
      to: email,
      subject: `${school?.name ?? 'Your school'}: parent portal invitation`,
      text: `Dear ${guardian.name},\n\nYou can now see your child's attendance, notices and fees online.\nSet your password here (valid 7 days, single use):\n${this.deps.env.APP_BASE_URL}/accept-invite?token=${token}\n`,
    });
    await AuditService.record({ action: 'parents.invited', entityType: 'student_guardian', entityId: link._id, after: { guardianId: String(guardian._id), membershipId: String(membership._id) } });
    return { membershipId: String(membership._id), email };
  }
}
