import type { Types } from 'mongoose';
import { definePlatformModel } from '../tenancy/registry';

export interface IAuditLog {
  _id?: Types.ObjectId;
  /** Null for platform-level events (e.g. school creation, CLI provisioning). */
  schoolId?: Types.ObjectId | null;
  actorUserId?: Types.ObjectId | null;
  actorMembershipId?: Types.ObjectId | null;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  supportGrantId?: Types.ObjectId | null;
  at: Date;
}

/**
 * Append-only. Platform-level collection with an OPTIONAL schoolId, so it is read only through
 * AuditService (which always scopes school reads to the tenant). No update/delete API exists.
 */
export const AuditLogModel = definePlatformModel<IAuditLog>(
  'AuditLog',
  {
    schoolId: { type: 'ObjectId', default: null },
    actorUserId: { type: 'ObjectId', default: null },
    actorMembershipId: { type: 'ObjectId', default: null },
    action: { type: String, required: true },
    entityType: String,
    entityId: String,
    before: { type: 'Mixed' },
    after: { type: 'Mixed' },
    meta: { type: 'Mixed' },
    ip: String,
    userAgent: { type: String, maxlength: 300 },
    requestId: String,
    supportGrantId: { type: 'ObjectId', default: null },
    at: { type: Date, required: true, default: () => new Date() },
  },
  (s) => {
    s.index({ schoolId: 1, at: -1 });
    s.index({ schoolId: 1, entityType: 1, entityId: 1, at: -1 });
    s.index({ schoolId: 1, action: 1, at: -1 });
  },
);
