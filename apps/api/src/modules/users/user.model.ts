import { Schema, type Types } from 'mongoose';
import { definePlatformModel } from '../../core/tenancy/registry';

export type UserStatus = 'invited' | 'active' | 'locked' | 'disabled';
export type PlatformRole = 'super_admin' | 'support';

export interface IUser {
  email?: string;
  phone?: string;
  passwordHash?: string;
  name: string;
  status: UserStatus;
  emailVerifiedAt?: Date;
  failedLogins: number;
  lockedUntil?: Date | null;
  lastLoginAt?: Date;
  platformRole?: PlatformRole;
  mfa?: { type: 'totp'; secretEnc: string; enabledAt: Date } | null;
  mfaPendingSecretEnc?: string | null;
  _id?: Types.ObjectId;
}

/** Global identity (one person, many school memberships). Platform-level: NOT tenant-scoped. */
export const UserModel = definePlatformModel<IUser>(
  'User',
  {
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    passwordHash: { type: String },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    status: { type: String, enum: ['invited', 'active', 'locked', 'disabled'], default: 'invited', required: true },
    emailVerifiedAt: { type: Date },
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date },
    platformRole: { type: String, enum: ['super_admin', 'support'] },
    mfa: { type: new Schema({ type: String, secretEnc: String, enabledAt: Date }, { _id: false }), default: null },
    mfaPendingSecretEnc: { type: String, default: null },
  },
  (s) => {
    s.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
    s.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
    s.index({ platformRole: 1 }, { sparse: true });
    s.pre('validate', function () {
      if (!this.email && !this.phone) throw new Error('A user needs at least one identifier (email or phone)');
    });
  },
);
