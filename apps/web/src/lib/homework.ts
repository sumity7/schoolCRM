import { post } from './api';

export interface HwFile { id: string; name: string; size: number; mime: string }
export interface HwSubmission { id: string; text: string | null; submittedAt: string; late: boolean; attempts: number; status: 'submitted' | 'reviewed'; marks: number | null; feedback: string | null; reviewedAt: string | null; reviewedByName: string | null; files?: HwFile[] }
export interface Homework {
  id: string; sectionId: string; sectionName: string; subjectId: string; subject: string; title: string; description: string; instructions: string | null; dueAt: string;
  maxMarks: number | null; allowLate: boolean; status: 'published' | 'withdrawn'; createdByName: string; publishedAt: string; files: HwFile[];
  mine?: HwSubmission | null; state?: 'pending' | 'submitted' | 'late' | 'reviewed' | 'overdue';
}
export interface MarkingRow { studentId: string; name: string; admissionNo: string; rollNo: number | null; state: 'missing' | 'submitted' | 'late' | 'reviewed'; submission: (HwSubmission & { files: HwFile[] }) | null }
export interface MarkingSheet { assignment: Homework; students: MarkingRow[]; summary: { total: number; submitted: number; late: number; reviewed: number; missing: number } }

export const MAX_UPLOAD_MB = 5;
export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx,.txt,.csv';

/** Reads a File as base64 (no data: prefix). The server re-checks type, size and content; this is only transport. */
export function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the file'));
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.readAsDataURL(file);
  });
}

export async function uploadFile(path: string, file: File): Promise<HwFile> {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new Error(`${file.name} is larger than ${MAX_UPLOAD_MB} MB`);
  return (await post<HwFile>(path, { filename: file.name, contentBase64: await toBase64(file) })).data;
}

export const dueText = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
export const stateTone = (s: string) => (s === 'reviewed' ? 'success' : s === 'submitted' ? 'primary' : s === 'late' || s === 'overdue' ? 'danger' : s === 'missing' ? 'warning' : 'muted') as 'success' | 'primary' | 'danger' | 'warning' | 'muted';
export const sizeText = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);
