export interface GradingScale { id: string; name: string; version: number; status: 'draft' | 'published'; bands: Array<{ minPct: number; grade: string; gradePoint?: number; remark?: string }> }
export interface Exam { id: string; sessionId: string; name: string; type: string; classIds: string[]; gradingScaleId: string; absentIsFail: boolean; status: 'draft' | 'marks_open' | 'marks_locked' | 'published'; publishedAt: string | null }
export interface ExamDetail extends Exam { subjects: Array<{ id: string; classId: string; subjectId: string; subject: string; maxMarks: number; passMarks: number; date: string | null }> }
export interface ResultRow {
  id: string; examId: string; studentId: string; sectionId: string; version: number; current: boolean;
  subjects: Array<{ subjectId: string; subject: string; obtained: number | null; max: number; status: string; passed: boolean | null; grade: string | null }>;
  totalObtained: number; totalMax: number; percentage: number | null; grade: string | null; resultStatus: 'pass' | 'fail' | 'incomplete'; rank: number | null;
  publishedAt: string | null; correction: { reason: string; previousVersion: number } | null;
  student?: { name: string; admissionNo: string }; examName?: string;
}
export const EXAM_STATUS: Record<Exam['status'], string> = { draft: 'Draft', marks_open: 'Marks entry open', marks_locked: 'Marks locked', published: 'Published' };
export const examTone = (s: Exam['status']) => (s === 'published' ? 'success' : s === 'marks_open' ? 'primary' : s === 'marks_locked' ? 'warning' : 'muted') as 'success' | 'primary' | 'warning' | 'muted';
export const resultTone = (s: ResultRow['resultStatus']) => (s === 'pass' ? 'success' : s === 'fail' ? 'danger' : 'muted') as 'success' | 'danger' | 'muted';
export const markCell = (s: { obtained: number | null; status: string }) => (s.status === 'absent' ? 'AB' : s.status === 'exempt' ? 'EX' : s.obtained === null ? '—' : String(s.obtained));
