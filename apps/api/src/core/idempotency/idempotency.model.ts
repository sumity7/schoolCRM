import { defineTenantModel } from '../tenancy/registry';

export interface IIdempotencyKey {
  key: string;
  route: string;
  requestHash: string;
  state: 'in_progress' | 'done';
  responseStatus?: number;
  responseBody?: unknown;
  createdAt?: Date;
}

/** Replay store for money-moving POSTs (doc 07 §0). Financial truth lives in payments/ledger, not here. */
export const IdempotencyKeyModel = defineTenantModel<IIdempotencyKey>(
  'IdempotencyKey',
  {
    key: { type: String, required: true, maxlength: 120 },
    route: { type: String, required: true },
    requestHash: { type: String, required: true },
    state: { type: String, enum: ['in_progress', 'done'], required: true, default: 'in_progress' },
    responseStatus: Number,
    responseBody: { type: 'Mixed' },
  },
  (s) => {
    s.index({ schoolId: 1, key: 1, route: 1 }, { unique: true });
    s.index({ createdAt: 1 }, { expireAfterSeconds: 48 * 3600 });
  },
);
