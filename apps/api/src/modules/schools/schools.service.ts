import type { Types } from 'mongoose';
import { classifyIdentifier } from '@edunex/shared';
import { AppError, conflict, notFound, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import type { EmailAdapter } from '../../core/notifications/email';
import { authTokens, memberships, schools, users } from '../auth/auth.repository';
import { hashPassword, hashToken, newToken } from '../auth/crypto';
import { seedSystemRoles } from '../roles/role-seed';
import type { ISchool, SchoolSettings } from './school.model';
import { DEFAULT_SETTINGS } from './school.defaults';
import type { IUser } from '../users/user.model';

export interface ProvisionInput {
  name: string;
  code: string;
  type?: ISchool['type'];
  board?: string;
  owner: { name: string; email: string; phone?: string };
  address?: ISchool['address'];
  officialEmail?: string;
  phone?: string;
  limits?: { students: number; staff: number };
  settings?: Partial<SchoolSettings>;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Platform-level provisioning (used by CLI scripts in R1 and by the Super Admin console in R5):
 * creates the tenant, seeds its roles, creates/links the owner and issues a single-use invitation.
 */
export async function provisionSchool(input: ProvisionInput, deps: { email?: EmailAdapter; appBaseUrl: string; actorUserId?: Types.ObjectId | null }) {
  const owner = classifyIdentifier(input.owner.email);
  if (!owner || owner.kind !== 'email') throw validationFailed('Owner email is invalid');
  if (await schools.findOne({ code: input.code.toLowerCase() }, 'provision: code check')) throw conflict('School code already exists');

  const school = await schools.create(
    {
      name: input.name,
      code: input.code.toLowerCase(),
      type: input.type ?? 'k12',
      board: input.board,
      address: input.address ?? {},
      officialEmail: input.officialEmail?.toLowerCase(),
      phone: input.phone,
      owner: { name: input.owner.name, email: owner.value, phone: input.owner.phone },
      status: 'onboarding',
      settings: { ...DEFAULT_SETTINGS, ...(input.settings ?? {}), attendancePolicy: { ...DEFAULT_SETTINGS.attendancePolicy, ...(input.settings?.attendancePolicy ?? {}) } },
      limits: input.limits ?? { students: 2000, staff: 200 },
    },
    'provision: create school',
  );
  await seedSystemRoles(school._id);

  let user = (await users.findOne({ email: owner.value }, 'provision: owner lookup')) as (IUser & { _id: Types.ObjectId }) | null;
  if (!user) {
    user = (await users.create({ email: owner.value, phone: undefined, name: input.owner.name, status: 'invited', failedLogins: 0 }, 'provision: create owner user')) as never;
  }
  const membership = await memberships.create(
    { schoolId: school._id, userId: user!._id, roleKeys: ['owner'], personType: 'owner', status: 'invited', invitedBy: deps.actorUserId ?? undefined },
    'provision: owner membership',
  );

  const token = newToken();
  await authTokens.create(
    { userId: user!._id, channel: 'email', destination: owner.value, purpose: 'invite', tokenHash: hashToken(token), membershipId: membership._id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
    'provision: invite token',
  );
  const link = `${deps.appBaseUrl}/accept-invite?token=${token}`;
  if (deps.email) {
    await deps.email.send({ to: owner.value, subject: `You're invited to set up ${school.name} on EduNex`, text: `Accept your invitation (valid 7 days, single use):\n${link}` });
  }
  await AuditService.record({ action: 'platform.school_provisioned', entityType: 'school', entityId: school._id, schoolId: school._id, actorUserId: deps.actorUserId ?? null, meta: { code: school.code } });
  return { school, ownerUserId: user!._id, membershipId: membership._id, inviteLink: link };
}

export async function createSuperAdmin(input: { email: string; name: string; password: string; role?: 'super_admin' | 'support' }) {
  const id = classifyIdentifier(input.email);
  if (!id || id.kind !== 'email') throw validationFailed('Invalid email');
  if (await users.findOne({ email: id.value }, 'cli: super admin exists?')) throw conflict('A user with this email already exists');
  const user = await users.create(
    { email: id.value, name: input.name, passwordHash: await hashPassword(input.password), status: 'active', platformRole: input.role ?? 'super_admin', failedLogins: 0, emailVerifiedAt: new Date() },
    'cli: create platform user',
  );
  await AuditService.record({ action: 'platform.admin_created', entityType: 'user', entityId: user._id, schoolId: null, actorUserId: null });
  return user;
}

export async function getSchoolById(id: Types.ObjectId) {
  const s = await schools.findById(id, 'schools: own profile');
  if (!s) throw notFound('School');
  return s;
}

export async function updateSchoolProfile(id: Types.ObjectId, patch: Record<string, unknown>) {
  const s = await schools.findOneAndUpdate({ _id: id }, { $set: patch }, 'schools: update own profile');
  if (!s) throw new AppError(404, 'NOT_FOUND', 'School not found');
  return s;
}
