import type { Types } from 'mongoose';
import { defineTenantModel } from '../../core/tenancy/registry';

/**
 * Year-end promotion decisions (R5, acceptance scenario 7). A decision creates the NEXT session's enrolment at once,
 * but the CURRENT session is left untouched until the next session is activated — then `finalize` closes the old
 * enrolments (promoted / retained / graduated). Old enrolments, attendance, invoices and results are never rewritten.
 */
export interface IPromotionRecord {
  studentId: Types.ObjectId;
  fromSessionId: Types.ObjectId;
  toSessionId: Types.ObjectId;
  fromEnrollmentId: Types.ObjectId;
  /** null for graduates */
  toEnrollmentId: Types.ObjectId | null;
  action: 'promote' | 'retain' | 'graduate';
  finalizedAt?: Date | null;
}
export const PromotionRecordModel = defineTenantModel<IPromotionRecord>(
  'PromotionRecord',
  {
    studentId: { type: 'ObjectId', required: true },
    fromSessionId: { type: 'ObjectId', required: true },
    toSessionId: { type: 'ObjectId', required: true },
    fromEnrollmentId: { type: 'ObjectId', required: true },
    toEnrollmentId: { type: 'ObjectId', default: null },
    action: { type: String, enum: ['promote', 'retain', 'graduate'], required: true },
    finalizedAt: { type: Date, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, toSessionId: 1, studentId: 1 }, { unique: true });
    s.index({ schoolId: 1, toSessionId: 1, finalizedAt: 1 });
  },
);
