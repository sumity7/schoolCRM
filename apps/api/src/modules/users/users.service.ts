import { Types } from 'mongoose';
import { ROLE_TEMPLATES, classifyIdentifier, scopeAtLeast, type PermissionKey, type Scope } from '@edunex/shared';
import type { Env } from '../../config/env';
import { conflict, entitlementRequired, forbidden, notFound, validationFailed } from '../../core/errors';
import type { EmailAdapter } from '../../core/notifications/email';
import { requireTenant, type TenantContext } from '../../core/tenancy/context';
import { toObjectId } from '../../core/tenancy/repository';
import { authTokens, schools, users } from '../auth/auth.repository';
import { hashToken, newToken } from '../auth/crypto';
import type { SessionService } from '../auth/session.service';
import { membershipRepository } from '../memberships/memberships.repository';
import { roleRepository } from '../roles/roles.repository';
import { AuditService } from '../../core/audit/audit.service';
import type { IUser } from './user.model';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A caller may only grant roles whose every permission they already hold at least at the same scope (no escalation). */
export function assertCanGrant(callerGrants: Map<PermissionKey, Scope>, rolePerms: Array<{ key: string; scope: string }>) {
  for (const p of rolePerms) {
    const have = callerGrants.get(p.key as PermissionKey);
    if (!scopeAtLeast(have, p.scope as Scope)) throw forbidden('You cannot assign a role with permissions you do not hold');
  }
}

export class UsersService {
  constructor(private readonly deps: { env: Env; email: EmailAdapter; sessions: SessionService }) {}

  async list(page: number, limit: number) {
    const res = await membershipRepository.paginate({}, page, limit, { createdAt: -1 });
    const userRows = await users.find({ _id: { $in: res.data.map((m) => m.userId) } }, 'users: names for membership list');
    const byId = new Map(userRows.map((u) => [String(u._id), u as IUser & { _id: Types.ObjectId }]));
    return {
      meta: res.meta,
      data: res.data.map((m) => {
        const u = byId.get(String(m.userId));
        return {
          membershipId: String(m._id),
          userId: String(m.userId),
          name: u?.name,
          email: u?.email,
          phone: u?.phone,
          roleKeys: m.roleKeys,
          status: m.status,
          personType: m.personType,
          version: m.__v,
        };
      }),
    };
  }

  private async validateRoles(tenant: TenantContext, roleKeys: string[]) {
    const unique = [...new Set(roleKeys)];
    const rows = await roleRepository.byKeys(unique);
    if (rows.length !== unique.length) throw validationFailed('Unknown role');
    for (const row of rows) {
      const tpl = ROLE_TEMPLATES.find((t) => t.key === row.key);
      if (tpl && !tpl.personTypes.includes('staff') && !tpl.personTypes.includes('owner')) {
        throw validationFailed(`The ${row.name} role cannot be assigned to staff accounts`);
      }
      if (row.key === 'owner' && !tenant.roleKeys.includes('owner')) throw forbidden('Only an Owner can assign the Owner role');
      assertCanGrant(tenant.grants, row.permissions);
    }
    return unique;
  }

  async invite(input: { name: string; email: string; phone?: string; roleKeys: string[] }) {
    const tenant = requireTenant('users.invite');
    const id = classifyIdentifier(input.email);
    if (!id || id.kind !== 'email') throw validationFailed('A valid email is required');
    const roleKeys = await this.validateRoles(tenant, input.roleKeys);

    const school = await schools.findById(tenant.schoolId, 'users: staff limit');
    const staffCount = await membershipRepository.countStaff();
    if (school && staffCount >= school.limits.staff) throw entitlementRequired('Staff limit for your plan has been reached');

    let user = (await users.findOne({ email: id.value }, 'users: invite lookup')) as (IUser & { _id: Types.ObjectId }) | null;
    if (!user) {
      user = (await users.create({ email: id.value, name: input.name, status: 'invited', failedLogins: 0 }, 'users: create invited user')) as never;
    }
    const existing = await membershipRepository.findOne({ userId: user!._id });
    if (existing && existing.status === 'active') throw conflict('This person is already a member of your school');
    const membership = existing
      ? await membershipRepository.updateById(existing._id, { roleKeys, status: 'invited', endedAt: null })
      : await membershipRepository.create({ userId: user!._id, roleKeys, personType: 'staff', status: 'invited', invitedBy: tenant.membershipId });

    const token = newToken();
    await authTokens.create(
      { userId: user!._id, channel: 'email', destination: id.value, purpose: 'invite', tokenHash: hashToken(token), membershipId: membership._id, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      'users: invite token',
    );
    await this.deps.email.send({
      to: id.value,
      subject: `You're invited to ${school?.name ?? 'your school'} on EduNex`,
      text: `Accept your invitation (valid 7 days, single use):\n${this.deps.env.APP_BASE_URL}/accept-invite?token=${token}`,
    });
    return { membership, userId: user!._id };
  }

  async update(membershipId: string, patch: { roleKeys?: string[]; status?: 'active' | 'suspended' }, expectedVersion?: number) {
    const tenant = requireTenant('users.update');
    const oid = toObjectId(membershipId);
    if (!oid) throw notFound('Membership');
    const current = await membershipRepository.getById(oid, 'Membership');
    if (current.userId.equals(tenant.userId)) throw forbidden('You cannot change your own roles or status');
    const set: Record<string, unknown> = {};

    if (patch.roleKeys) {
      const roleKeys = await this.validateRoles(tenant, patch.roleKeys);
      if (current.roleKeys.includes('owner') && !roleKeys.includes('owner')) {
        if (!tenant.roleKeys.includes('owner')) throw forbidden('Only an Owner can demote an Owner');
        if ((await membershipRepository.countActiveOwners()) <= 1) throw conflict('A school must keep at least one Owner');
      }
      set.roleKeys = roleKeys;
    }
    if (patch.status) {
      if (patch.status === 'suspended' && current.roleKeys.includes('owner')) {
        if (!tenant.roleKeys.includes('owner')) throw forbidden('Only an Owner can suspend an Owner');
        if ((await membershipRepository.countActiveOwners()) <= 1) throw conflict('A school must keep at least one Owner');
      }
      if (patch.status === 'active' && current.status === 'invited') throw conflict('Invitations are activated by the invitee');
      set.status = patch.status;
    }
    const updated = await membershipRepository.updateById(oid, set, { expectedVersion, what: 'Membership' });
    if (set.status === 'suspended' || set.roleKeys) await this.deps.sessions.revokeForMembership(oid); // changes apply immediately
    await AuditService.record({ action: 'users.membership_updated', entityType: 'membership', entityId: oid, before: { roleKeys: current.roleKeys, status: current.status }, after: set });
    return updated;
  }
}
