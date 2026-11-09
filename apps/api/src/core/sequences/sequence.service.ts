import { requireTenant } from '../tenancy/context';
import { CounterModel } from './counter.model';

/**
 * Atomic per-school sequences. Call inside the SAME transaction as the record that consumes the number,
 * so a rolled-back transaction also rolls back the increment (doc 05 §6 receipt numbering).
 */
export const SequenceService = {
  async next(key: string): Promise<number> {
    const t = requireTenant(`sequence.${key}`);
    // Model access inside a *.service file for the counter only: the counter has no read API beyond $inc.
    const doc = await CounterModel.findOneAndUpdate(
      { schoolId: t.schoolId, key },
      { $inc: { seq: 1 }, $setOnInsert: {} },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
    return doc!.seq;
  },

  async peek(key: string): Promise<number> {
    const t = requireTenant(`sequence.peek.${key}`);
    const doc = await CounterModel.findOne({ schoolId: t.schoolId, key }).lean();
    return doc?.seq ?? 0;
  },
};

/** Formats e.g. PREFIX/2026-27/000123 */
export function formatSequence(prefix: string, series: string, n: number, width = 6): string {
  return `${prefix}/${series}/${String(n).padStart(width, '0')}`;
}
