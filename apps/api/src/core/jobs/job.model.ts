import { Schema, type Types } from 'mongoose';
import { defineTenantModel } from '../tenancy/registry';

/**
 * Background jobs (ADR-5, re-evaluated at the start of R3: still MongoDB-backed — no Redis at zero budget; the
 * interface stays small so BullMQ could replace it). Tenant-owned: a job always runs inside its school's context.
 */
export interface IJob {
  type: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'done' | 'dead';
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  lockedUntil?: Date | null;
  lockedBy?: string | null;
  lastError?: string | null;
  /** optional de-duplication key (unique per school) */
  key?: string | null;
  /** membership that enqueued it — the handler runs with that member's school context */
  createdByMembership: Types.ObjectId;
  createdByUser: Types.ObjectId;
  doneAt?: Date | null;
}

export const JobModel = defineTenantModel<IJob>(
  'Job',
  {
    type: { type: String, required: true, maxlength: 60 },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['queued', 'running', 'done', 'dead'], required: true, default: 'queued' },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    runAt: { type: Date, required: true },
    lockedUntil: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    lastError: { type: String, default: null },
    key: { type: String, default: null },
    createdByMembership: { type: 'ObjectId', required: true },
    createdByUser: { type: 'ObjectId', required: true },
    doneAt: { type: Date, default: null },
  },
  (s) => {
    s.index({ status: 1, runAt: 1 }); // claim query is cross-tenant (worker)
    s.index({ status: 1, lockedUntil: 1 });
    s.index({ schoolId: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $type: 'string' } } });
    s.index({ schoolId: 1, createdAt: -1 });
  },
);
