import { Schema, type Types } from 'mongoose';
import type { ImportBatchStatus, ImportDateFormat, ImportMapping, ImportRowStatus } from '@edunex/shared';
import { defineTenantModel } from '../../core/tenancy/registry';

export interface ImportRowResult {
  /** Line number in the uploaded file (header = line 1). */
  line: number;
  status: ImportRowStatus;
  messages: string[];
  studentId?: Types.ObjectId | null;
}

export interface IImportBatch {
  entity: 'students';
  filename: string;
  headers: string[];
  /** Raw cells (R1: ≤ 2,000 rows, so the batch document stays far below the 16 MB limit). */
  rows: string[][];
  mapping: ImportMapping;
  options: { dateFormat: ImportDateFormat };
  status: ImportBatchStatus;
  counts: { total: number; ok: number; duplicate: number; error: number; created: number; rolledBack: number; kept: number };
  results: ImportRowResult[];
  /** First valid rows as they will be saved (shown before commit). */
  preview: Array<Record<string, unknown>>;
  validatedAt?: Date | null;
  committedAt?: Date | null;
  committedBy?: Types.ObjectId | null;
  rolledBackAt?: Date | null;
  failureReason?: string | null;
}

/** Records created by a commit carry `importBatchId` (students, enrollments, guardians, links) → precise rollback. */
export const ImportBatchModel = defineTenantModel<IImportBatch>(
  'ImportBatch',
  {
    entity: { type: String, enum: ['students'], required: true },
    filename: { type: String, required: true, maxlength: 200 },
    headers: { type: [String], default: [] },
    rows: { type: Schema.Types.Mixed, default: [] },
    mapping: { type: Schema.Types.Mixed, default: {} },
    options: { type: new Schema({ dateFormat: { type: String, enum: ['DMY', 'YMD', 'MDY'], default: 'DMY' } }, { _id: false }), default: () => ({ dateFormat: 'DMY' }) },
    status: { type: String, enum: ['uploaded', 'validated', 'committing', 'committed', 'failed', 'rolled_back'], required: true, default: 'uploaded' },
    counts: {
      type: new Schema(
        { total: Number, ok: Number, duplicate: Number, error: Number, created: Number, rolledBack: Number, kept: Number },
        { _id: false },
      ),
      default: () => ({ total: 0, ok: 0, duplicate: 0, error: 0, created: 0, rolledBack: 0, kept: 0 }),
    },
    results: { type: Schema.Types.Mixed, default: [] },
    preview: { type: Schema.Types.Mixed, default: [] },
    validatedAt: { type: Date, default: null },
    committedAt: { type: Date, default: null },
    committedBy: { type: 'ObjectId', default: null },
    rolledBackAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, createdAt: -1 });
  },
);
