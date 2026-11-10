import type { Types } from 'mongoose';
import type { TenantContext } from '../tenancy/context';

export interface AuthUser {
  _id: Types.ObjectId;
  name: string;
  email?: string;
  phone?: string;
  passwordHash?: string;
  platformRole?: 'super_admin' | 'support';
  status: string;
  mfaEnabled?: boolean;
}

export interface AuthSession {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  activeMembershipId?: Types.ObjectId | null;
  rememberMe: boolean;
  mfaPending?: boolean;
}

export interface AuthSchool {
  _id: Types.ObjectId;
  name: string;
  code: string;
  status: string;
  settings: { timezone: string; workingDays: number[]; [k: string]: unknown };
  limits: { students: number; staff: number };
}

export interface AuthContext {
  user: AuthUser;
  session: AuthSession;
  tenant?: TenantContext;
  school?: AuthSchool;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
    }
  }
}
