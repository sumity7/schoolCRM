import type { ImportBatchStatus, ImportDateFormat, ImportFieldDef, ImportMapping } from '@edunex/shared';

export interface ImportCounts { total: number; ok: number; duplicate: number; error: number; created: number; rolledBack: number; kept: number }

export interface ImportSummary {
  id: string; entity: 'students'; filename: string; status: ImportBatchStatus; counts: ImportCounts; rowCount: number;
  createdAt: string; validatedAt: string | null; committedAt: string | null; rolledBackAt: string | null; failureReason: string | null;
}

export interface ImportDetail extends ImportSummary {
  headers: string[];
  mapping: ImportMapping;
  options: { dateFormat: ImportDateFormat };
  sample: string[][];
  fields: ImportFieldDef[];
  mappingProblems: string[];
  preview: Array<{ line: number; admissionNo: string; name: string; dob: string; gender: string | null; class: string | null; rollNo: number | null; guardian: string | null }>;
  problems: Array<{ line: number; status: 'error' | 'duplicate'; messages: string[] }>;
}

export const importStatusLabel: Record<ImportBatchStatus, string> = {
  uploaded: 'Needs checking', validated: 'Checked — ready to import', committing: 'Importing…', committed: 'Imported', failed: 'Failed', rolled_back: 'Rolled back',
};
export const importStatusTone = (s: ImportBatchStatus) =>
  (s === 'committed' ? 'success' : s === 'failed' ? 'danger' : s === 'rolled_back' ? 'warning' : s === 'validated' ? 'primary' : 'muted') as 'success' | 'danger' | 'warning' | 'primary' | 'muted';
