import type { Types } from 'mongoose';
import { definePlatformModel } from '../../core/tenancy/registry';

export interface ISession {
  _id?: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  activeMembershipId?: Types.ObjectId | null;
  rememberMe: boolean;
  ip?: string;
  userAgent?: string;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt?: Date | null;
  supportGrantId?: Types.ObjectId;
  /** Password accepted but the two-factor code is still outstanding: only the MFA routes work. */
  mfaPending?: boolean;
}

/** Server-side sessions (ADR-1). Only SHA-256(token) is stored. */
export const SessionModel = definePlatformModel<ISession>(
  'Session',
  {
    userId: { type: 'ObjectId', required: true, ref: 'User' },
    tokenHash: { type: String, required: true },
    activeMembershipId: { type: 'ObjectId', default: null },
    rememberMe: { type: Boolean, default: false },
    ip: String,
    userAgent: { type: String, maxlength: 300 },
    lastSeenAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    mfaPending: { type: Boolean, default: false },
    supportGrantId: { type: 'ObjectId' },
  },
  (s) => {
    s.index({ tokenHash: 1 }, { unique: true });
    s.index({ userId: 1, revokedAt: 1 });
    s.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  },
);
