import { Schema, type Types } from 'mongoose';
import { defineTenantModel } from '../../core/tenancy/registry';
import type { GradeBand } from '@edunex/shared';

/** Exams & results (doc 05 §7). Results are computed snapshots; once PUBLISHED they are never edited — a correction
 * creates version n+1 with a reason, and the old version stays retrievable. */

const band = new Schema({ minPct: { type: Number, required: true }, grade: { type: String, required: true, maxlength: 10 }, gradePoint: Number, remark: { type: String, maxlength: 60 } }, { _id: false });

export interface IGradingScale { name: string; familyKey: string; version: number; bands: GradeBand[]; status: 'draft' | 'published' }
export const GradingScaleModel = defineTenantModel<IGradingScale>(
  'GradingScale',
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    familyKey: { type: String, required: true },
    version: { type: Number, required: true },
    bands: { type: [band], default: [] },
    status: { type: String, enum: ['draft', 'published'], required: true, default: 'draft' },
  },
  (s) => s.index({ schoolId: 1, familyKey: 1, version: 1 }, { unique: true }),
);

export interface IExam {
  sessionId: Types.ObjectId;
  name: string;
  type: 'unit' | 'midterm' | 'final' | 'practical' | 'internal';
  classIds: Types.ObjectId[];
  gradingScaleId: Types.ObjectId;
  absentIsFail: boolean;
  status: 'draft' | 'marks_open' | 'marks_locked' | 'published';
  publishedAt?: Date | null;
}
export const ExamModel = defineTenantModel<IExam>(
  'Exam',
  {
    sessionId: { type: 'ObjectId', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: ['unit', 'midterm', 'final', 'practical', 'internal'], required: true },
    classIds: { type: ['ObjectId'], default: [], validate: (v: unknown[]) => v.length >= 1 && v.length <= 20 },
    gradingScaleId: { type: 'ObjectId', required: true },
    absentIsFail: { type: Boolean, default: true },
    status: { type: String, enum: ['draft', 'marks_open', 'marks_locked', 'published'], required: true, default: 'draft' },
    publishedAt: { type: Date, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, sessionId: 1, status: 1 });
    s.index({ schoolId: 1, sessionId: 1, name: 1 }, { unique: true });
  },
);

export interface IExamSubject { examId: Types.ObjectId; classId: Types.ObjectId; subjectId: Types.ObjectId; maxMarks: number; passMarks: number; date?: string | null }
export const ExamSubjectModel = defineTenantModel<IExamSubject>(
  'ExamSubject',
  {
    examId: { type: 'ObjectId', required: true },
    classId: { type: 'ObjectId', required: true },
    subjectId: { type: 'ObjectId', required: true },
    maxMarks: { type: Number, required: true, min: 1, max: 1000 },
    passMarks: { type: Number, required: true, min: 0 },
    date: { type: String, default: null },
  },
  (s) => s.index({ schoolId: 1, examId: 1, classId: 1, subjectId: 1 }, { unique: true }),
);

export interface IMark {
  examId: Types.ObjectId;
  examSubjectId: Types.ObjectId;
  studentId: Types.ObjectId;
  enrollmentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  /** null = not entered (≠ 0) */
  obtained: number | null;
  status: 'entered' | 'absent' | 'exempt';
}
export const MarkModel = defineTenantModel<IMark>(
  'Mark',
  {
    examId: { type: 'ObjectId', required: true },
    examSubjectId: { type: 'ObjectId', required: true },
    studentId: { type: 'ObjectId', required: true },
    enrollmentId: { type: 'ObjectId', required: true },
    sectionId: { type: 'ObjectId', required: true },
    obtained: { type: Number, default: null },
    status: { type: String, enum: ['entered', 'absent', 'exempt'], required: true },
  },
  (s) => {
    s.index({ schoolId: 1, examSubjectId: 1, studentId: 1 }, { unique: true });
    s.index({ schoolId: 1, examId: 1, studentId: 1 });
  },
);

export interface IResult {
  examId: Types.ObjectId;
  studentId: Types.ObjectId;
  enrollmentId: Types.ObjectId;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  version: number;
  current: boolean;
  subjectResults: Array<{ subjectId: Types.ObjectId; obtained: number | null; max: number; status: string; passed: boolean | null; grade: string | null; percentage: number | null }>;
  totalObtained: number;
  totalMax: number;
  percentage: number | null;
  grade: string | null;
  resultStatus: 'pass' | 'fail' | 'incomplete';
  rank: number | null;
  gradingScaleSnapshot: { id: Types.ObjectId; version: number; bands: GradeBand[] };
  publishedAt?: Date | null;
  correction?: { reason: string; previousVersion: number } | null;
}
export const ResultModel = defineTenantModel<IResult>(
  'Result',
  {
    examId: { type: 'ObjectId', required: true },
    studentId: { type: 'ObjectId', required: true },
    enrollmentId: { type: 'ObjectId', required: true },
    classId: { type: 'ObjectId', required: true },
    sectionId: { type: 'ObjectId', required: true },
    version: { type: Number, required: true },
    current: { type: Boolean, required: true },
    subjectResults: { type: Schema.Types.Mixed, default: [] },
    totalObtained: { type: Number, required: true },
    totalMax: { type: Number, required: true },
    percentage: { type: Number, default: null },
    grade: { type: String, default: null },
    resultStatus: { type: String, enum: ['pass', 'fail', 'incomplete'], required: true },
    rank: { type: Number, default: null },
    gradingScaleSnapshot: { type: Schema.Types.Mixed, required: true },
    publishedAt: { type: Date, default: null },
    correction: { type: Schema.Types.Mixed, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, examId: 1, studentId: 1, version: 1 }, { unique: true });
    s.index({ schoolId: 1, examId: 1, studentId: 1 }, { unique: true, partialFilterExpression: { current: true }, name: 'one_current_result' });
    s.index({ schoolId: 1, studentId: 1, current: 1 });
    s.index({ schoolId: 1, examId: 1, sectionId: 1, current: 1 });
  },
);
