import type { Types } from 'mongoose';
import { classifyIdentifier, type MeResponse, type MembershipSummary, type PermissionKey } from '@edunex/shared';
import type { Env } from '../../config/env';
import { AppError, notFound, unauthenticated, validationFailed } from '../../core/errors';
import { AuditService } from '../../core/audit/audit.service';
import type { EmailAdapter } from '../../core/notifications/email';
import { authTokens, memberships, schools, users } from './auth.repository';
import { hashPassword, hashToken, newToken, verifyPassword } from './crypto';
import { resolveTenantContext, ACTIVE_SCHOOL_STATUSES } from './context.service';
import type { SessionService, SessionRow } from './session.service';
import type { IUser } from '../users/user.model';

type UserRow = IUser & { _id: Types.ObjectId };

const GENERIC_LOGIN_FAILURE = 'Invalid credentials';
const RESET_TTL_MS = 60 * 60 * 1000;

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export class AuthService {
  constructor(private readonly deps: { env: Env; sessions: SessionService; email: EmailAdapter }) {}

  private get env() {
    return this.deps.env;
  }

  // -------------------------------------------------------------------------
  async login(input: { identifier: string; password: string; rememberMe?: boolean }, meta: ClientMeta, previousSession?: SessionRow | null) {
    const id = classifyIdentifier(input.identifier);
    const user = id ? ((await users.findOne(id.kind === 'email' ? { email: id.value } : { phone: id.value }, 'auth: login lookup')) as UserRow | null) : null;

    const passwordOk = await verifyPassword(user?.passwordHash, input.password);
    const now = new Date();
    const locked = Boolean(user?.lockedUntil && user.lockedUntil.getTime() > now.getTime());

    if (!user || !passwordOk || locked || user.status !== 'active') {
      if (user && !passwordOk && !locked) {
        const failures = (user.failedLogins ?? 0) + 1;
        if (failures >= this.env.LOGIN_MAX_FAILURES) {
          await users.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: new Date(now.getTime() + this.env.LOGIN_LOCK_MINUTES * 60_000) } }, 'auth: lockout');
          await AuditService.record({ action: 'auth.account_locked', entityType: 'user', entityId: user._id, actorUserId: user._id, schoolId: null });
        } else {
          await users.updateOne({ _id: user._id }, { $set: { failedLogins: failures } }, 'auth: count failure');
        }
      }
      await AuditService.record({ action: 'auth.login_failed', entityType: 'user', entityId: user?._id, actorUserId: user?._id ?? null, schoolId: null, meta: { identifierKind: id?.kind ?? 'invalid' } });
      // One generic response for unknown user / bad password / locked / disabled → no enumeration.
      throw unauthenticated(GENERIC_LOGIN_FAILURE);
    }

    await users.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: null, lastLoginAt: now } }, 'auth: login success');
    if (previousSession) await this.deps.sessions.revoke(previousSession._id); // no session fixation

    const available = await this.activeMemberships(user._id);
    const auto = available.length === 1 && !user.platformRole ? available[0]! : null;
    const created = await this.deps.sessions.create({
      userId: user._id,
      rememberMe: Boolean(input.rememberMe),
      ip: meta.ip,
      userAgent: meta.userAgent,
      activeMembershipId: auto ? (auto.membershipObjectId as Types.ObjectId) : null,
      mfaPending: Boolean(user.mfa?.enabledAt),
    });
    await AuditService.record({ action: 'auth.login', entityType: 'user', entityId: user._id, actorUserId: user._id, schoolId: auto ? (auto.schoolObjectId as Types.ObjectId) : null });
    const me = await this.buildMe(user, created.session);
    return { token: created.token, maxAgeMs: created.maxAgeMs, me };
  }

  // -------------------------------------------------------------------------
  /** Active memberships whose school is operational. */
  async activeMemberships(userId: Types.ObjectId): Promise<Array<MembershipSummary & { membershipObjectId: Types.ObjectId; schoolObjectId: Types.ObjectId }>> {
    const ms = await memberships.find({ userId, status: 'active' }, 'auth: list my memberships');
    if (ms.length === 0) return [];
    const schoolIds = [...new Set(ms.map((m) => String((m as unknown as { schoolId: Types.ObjectId }).schoolId)))];
    const rows = await schools.find({ _id: { $in: schoolIds } }, 'auth: schools for memberships');
    const byId = new Map(rows.map((s) => [String(s._id), s]));
    const out: Array<MembershipSummary & { membershipObjectId: Types.ObjectId; schoolObjectId: Types.ObjectId }> = [];
    for (const m of ms) {
      const sid = String((m as unknown as { schoolId: Types.ObjectId }).schoolId);
      const s = byId.get(sid);
      if (!s || !ACTIVE_SCHOOL_STATUSES.includes(s.status)) continue;
      out.push({ membershipId: String(m._id), schoolId: sid, schoolName: s.name, schoolCode: s.code, roleKeys: m.roleKeys, membershipObjectId: m._id, schoolObjectId: s._id });
    }
    return out;
  }

  async buildMe(user: UserRow, session: SessionRow): Promise<MeResponse> {
    const mfa = { enabled: Boolean(user.mfa?.enabledAt), pending: Boolean((session as { mfaPending?: boolean }).mfaPending) };
    if (mfa.pending) {
      // nothing about schools is revealed before the second factor
      return { user: { id: String(user._id), name: user.name }, activeMembershipId: null, school: null, roleKeys: [], permissions: [], memberships: [], platformRole: null, mfa };
    }
    const list = await this.activeMemberships(user._id);
    const resolved = await resolveTenantContext(user, session.activeMembershipId);
    return {
      user: { id: String(user._id), name: user.name, email: user.email, phone: user.phone },
      activeMembershipId: resolved ? String(resolved.tenant.membershipId) : null,
      school: resolved ? { id: String(resolved.school._id), name: resolved.school.name, code: resolved.school.code, timezone: resolved.school.settings.timezone } : null,
      roleKeys: resolved?.tenant.roleKeys ?? [],
      permissions: resolved ? [...resolved.tenant.grants.entries()].map(([key, scope]: [PermissionKey, string]) => ({ key, scope })) : [],
      memberships: list.map(({ membershipObjectId: _m, schoolObjectId: _s, ...rest }) => rest),
      platformRole: user.platformRole ?? null,
      mfa,
    };
  }

  // -------------------------------------------------------------------------
  async selectSchool(user: UserRow, session: SessionRow, membershipId: Types.ObjectId) {
    const list = await this.activeMemberships(user._id);
    const target = list.find((m) => m.membershipObjectId.equals(membershipId));
    if (!target) throw notFound('Membership'); // not yours / not active → same answer
    await this.deps.sessions.setActiveMembership(session._id, membershipId);
    await AuditService.record({ action: 'auth.switch_school', entityType: 'membership', entityId: membershipId, actorUserId: user._id, schoolId: target.schoolObjectId });
    const fresh = { ...session, activeMembershipId: membershipId } as SessionRow;
    return this.buildMe(user, fresh);
  }

  async logout(user: UserRow | null, session: SessionRow) {
    await this.deps.sessions.revoke(session._id);
    await AuditService.record({ action: 'auth.logout', entityType: 'session', entityId: session._id, actorUserId: user?._id ?? null, schoolId: null });
  }

  async logoutAll(user: UserRow) {
    await this.deps.sessions.revokeAllForUser(user._id);
    await AuditService.record({ action: 'auth.logout_all', entityType: 'user', entityId: user._id, actorUserId: user._id, schoolId: null });
  }

  // -------------------------------------------------------------------------
  async forgotPassword(identifier: string): Promise<void> {
    const id = classifyIdentifier(identifier);
    if (!id) return;
    const user = (await users.findOne(id.kind === 'email' ? { email: id.value } : { phone: id.value }, 'auth: forgot lookup')) as UserRow | null;
    if (!user || user.status !== 'active' || !user.email) return; // silent: no enumeration (phone reset arrives with an SMS adapter)
    const token = newToken();
    await authTokens.create(
      { userId: user._id, channel: 'email', destination: user.email, purpose: 'reset', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      'auth: create reset token',
    );
    await this.deps.email.send({
      to: user.email,
      subject: 'Reset your EduNex password',
      text: `Use this link to reset your password (valid for 1 hour, single use):\n${this.env.APP_BASE_URL}/reset-password?token=${token}\n\nIf you didn't request this, ignore this email.`,
    });
    await AuditService.record({ action: 'auth.password_reset_requested', entityType: 'user', entityId: user._id, actorUserId: user._id, schoolId: null });
  }

  /** Atomically consumes a single-use token; returns the row or throws a generic error. */
  private async consumeToken(token: string, purpose: 'reset' | 'invite') {
    const row = await authTokens.findOneAndUpdate(
      { tokenHash: hashToken(token), purpose, usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      'auth: consume token',
    );
    if (!row) throw validationFailed('This link is invalid or has expired');
    return row;
  }

  async resetPassword(token: string, newPassword: string) {
    const row = await this.consumeToken(token, 'reset');
    const user = (await users.findById(row.userId, 'auth: reset user')) as UserRow | null;
    if (!user) throw validationFailed('This link is invalid or has expired');
    await users.updateOne(
      { _id: user._id },
      { $set: { passwordHash: await hashPassword(newPassword), failedLogins: 0, lockedUntil: null, status: 'active' } },
      'auth: set new password',
    );
    await this.deps.sessions.revokeAllForUser(user._id);
    await AuditService.record({ action: 'auth.password_reset', entityType: 'user', entityId: user._id, actorUserId: user._id, schoolId: null });
  }

  async changePassword(user: UserRow, session: SessionRow, currentPassword: string, newPassword: string) {
    const ok = await verifyPassword(user.passwordHash, currentPassword);
    if (!ok) throw new AppError(400, 'VALIDATION_FAILED', 'Current password is incorrect');
    await users.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(newPassword) } }, 'auth: change password');
    await this.deps.sessions.revokeAllForUser(user._id, session._id);
    await AuditService.record({ action: 'auth.password_changed', entityType: 'user', entityId: user._id, actorUserId: user._id, schoolId: null });
  }

  /**
   * Accepting an invitation proves control of the invited address. New users set a password;
   * existing users (already a member of another school) just have this membership activated.
   */
  async acceptInvite(token: string, password: string | undefined, name: string | undefined) {
    const row = await this.consumeToken(token, 'invite');
    const user = (await users.findById(row.userId, 'auth: invite user')) as UserRow | null;
    if (!user || !row.membershipId) throw validationFailed('This link is invalid or has expired');
    // Validate the membership BEFORE changing the user, so a stale/revoked invitation changes nothing.
    const pending = await memberships.findOne({ _id: row.membershipId, userId: user._id, status: 'invited' }, 'auth: invite membership');
    if (!pending) throw validationFailed('This link is invalid or has expired');
    const patch: Record<string, unknown> = {};
    if (!user.passwordHash) {
      if (!password) {
        // un-consume so the person can retry with a password
        await authTokens.updateOne({ _id: row._id }, { $set: { usedAt: null } }, 'auth: restore invite token');
        throw validationFailed('A password is required to accept this invitation');
      }
      patch.passwordHash = await hashPassword(password);
    }
    // A student's name comes from the school's record; the activation page cannot rename them.
    if (name && (pending as unknown as { personType?: string }).personType !== 'student') patch.name = name;
    if (row.channel === 'email') patch.emailVerifiedAt = new Date();
    patch.status = 'active';
    const m = await memberships.findOneAndUpdate({ _id: row.membershipId, userId: user._id, status: 'invited' }, { $set: { status: 'active' } }, 'auth: activate membership');
    if (!m) throw validationFailed('This link is invalid or has expired');
    await users.updateOne({ _id: user._id }, { $set: patch }, 'auth: accept invite user');
    await AuditService.record({ action: 'auth.invite_accepted', entityType: 'membership', entityId: m._id, actorUserId: user._id, schoolId: (m as unknown as { schoolId: Types.ObjectId }).schoolId });
  }
}
