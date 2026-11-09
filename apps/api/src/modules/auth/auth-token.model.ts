import type { Types } from 'mongoose';
import { definePlatformModel } from '../../core/tenancy/registry';

export type AuthTokenPurpose = 'reset' | 'verify' | 'invite';

export interface IAuthToken {
  _id?: Types.ObjectId;
  userId?: Types.ObjectId;
  channel: 'email' | 'phone';
  destination: string;
  purpose: AuthTokenPurpose;
  tokenHash: string;
  /** For invites: the membership to activate on acceptance. */
  membershipId?: Types.ObjectId;
  expiresAt: Date;
  usedAt?: Date | null;
}

/** Single-use, hashed-at-rest tokens for password reset / verification / invitation. */
export const AuthTokenModel = definePlatformModel<IAuthToken>(
  'AuthToken',
  {
    userId: { type: 'ObjectId', ref: 'User' },
    channel: { type: String, enum: ['email', 'phone'], required: true },
    destination: { type: String, required: true },
    purpose: { type: String, enum: ['reset', 'verify', 'invite'], required: true },
    tokenHash: { type: String, required: true },
    membershipId: { type: 'ObjectId' },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  (s) => {
    s.index({ tokenHash: 1 }, { unique: true });
    s.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    s.index({ userId: 1, purpose: 1 });
  },
);
