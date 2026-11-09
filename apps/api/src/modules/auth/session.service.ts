import { Types } from 'mongoose';
import type { Env } from '../../config/env';
import { sessions } from './auth.repository';
import { hashToken, newToken } from './crypto';
import type { ISession } from './session.model';

export type SessionRow = ISession & { _id: Types.ObjectId };

export interface SessionPolicy {
  idleMinutes: number;
  absoluteDays: number;
  rememberDays: number;
}

export function policyFromEnv(env: Env): SessionPolicy {
  return { idleMinutes: env.SESSION_IDLE_MINUTES, absoluteDays: env.SESSION_ABSOLUTE_DAYS, rememberDays: env.SESSION_REMEMBER_DAYS };
}

const TOUCH_INTERVAL_MS = 60_000;

export class SessionService {
  constructor(private readonly policy: SessionPolicy) {}

  async create(opts: { userId: Types.ObjectId; rememberMe: boolean; ip?: string; userAgent?: string; activeMembershipId?: Types.ObjectId | null }) {
    const token = newToken();
    const now = new Date();
    const days = opts.rememberMe ? this.policy.rememberDays : this.policy.absoluteDays;
    const row = await sessions.create(
      {
        userId: opts.userId,
        tokenHash: hashToken(token),
        activeMembershipId: opts.activeMembershipId ?? null,
        rememberMe: opts.rememberMe,
        ip: opts.ip,
        userAgent: opts.userAgent?.slice(0, 300),
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + days * 86_400_000),
      },
      'auth: create session',
    );
    return { token, session: row as SessionRow, maxAgeMs: days * 86_400_000 };
  }

  /** Returns the live session for a cookie token, or null (unknown/revoked/expired/idle-timeout). */
  async resolve(token: string | undefined): Promise<SessionRow | null> {
    if (!token || token.length < 20 || token.length > 200) return null;
    const row = (await sessions.findOne({ tokenHash: hashToken(token) }, 'auth: resolve session')) as SessionRow | null;
    if (!row || row.revokedAt) return null;
    const now = Date.now();
    if (row.expiresAt.getTime() <= now) return null;
    if (row.lastSeenAt.getTime() + this.policy.idleMinutes * 60_000 <= now) {
      await this.revoke(row._id);
      return null;
    }
    if (now - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await sessions.updateOne({ _id: row._id }, { $set: { lastSeenAt: new Date(now) } }, 'auth: touch session');
    }
    return row;
  }

  async setActiveMembership(sessionId: Types.ObjectId, membershipId: Types.ObjectId | null) {
    await sessions.updateOne({ _id: sessionId }, { $set: { activeMembershipId: membershipId } }, 'auth: switch school');
  }

  async revoke(sessionId: Types.ObjectId) {
    await sessions.updateOne({ _id: sessionId, revokedAt: null }, { $set: { revokedAt: new Date() } }, 'auth: revoke session');
  }

  async revokeAllForUser(userId: Types.ObjectId, exceptId?: Types.ObjectId) {
    const filter: Record<string, unknown> = { userId, revokedAt: null };
    if (exceptId) filter._id = { $ne: exceptId };
    await sessions.updateMany(filter, { $set: { revokedAt: new Date() } }, 'auth: revoke all sessions');
  }

  async revokeForMembership(membershipId: Types.ObjectId) {
    await sessions.updateMany({ activeMembershipId: membershipId, revokedAt: null }, { $set: { revokedAt: new Date() } }, 'auth: revoke sessions for membership');
  }

  async listForUser(userId: Types.ObjectId) {
    return sessions.find({ userId, revokedAt: null, expiresAt: { $gt: new Date() } }, 'auth: list own sessions', { sort: { lastSeenAt: -1 }, limit: 50 });
  }
}
