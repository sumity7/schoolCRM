import type { Types } from 'mongoose';
import { defineTenantModel } from '../../core/tenancy/registry';

/** A stored file. The bytes live in the storage provider under `storageKey`; this row carries ownership and linkage. */
export interface IStoredFile {
  purpose: 'assignment' | 'submission';
  storageKey: string;
  name: string;
  ext: string;
  mime: string;
  size: number;
  sha256: string;
  uploadedByMembershipId: Types.ObjectId;
  /** null until the file is attached to an assignment / submission (unattached files are visible to their uploader only) */
  assignmentId?: Types.ObjectId | null;
  submissionId?: Types.ObjectId | null;
}
export const StoredFileModel = defineTenantModel<IStoredFile>(
  'StoredFile',
  {
    purpose: { type: String, enum: ['assignment', 'submission'], required: true },
    storageKey: { type: String, required: true },
    name: { type: String, required: true, maxlength: 100 },
    ext: { type: String, required: true, maxlength: 10 },
    mime: { type: String, required: true, maxlength: 120 },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
    uploadedByMembershipId: { type: 'ObjectId', required: true },
    assignmentId: { type: 'ObjectId', default: null },
    submissionId: { type: 'ObjectId', default: null },
  },
  (s) => {
    s.index({ schoolId: 1, storageKey: 1 }, { unique: true });
    s.index({ schoolId: 1, assignmentId: 1 }, { sparse: true });
    s.index({ schoolId: 1, submissionId: 1 }, { sparse: true });
  },
);

export interface IAssignment {
  sessionId: Types.ObjectId;
  sectionId: Types.ObjectId;
  subjectId: Types.ObjectId;
  /** the teacher (staff record) who set it; null when an administrator set it without being linked to a staff record */
  staffId?: Types.ObjectId | null;
  title: string;
  description: string;
  instructions?: string;
  dueAt: Date;
  maxMarks?: number | null;
  allowLate: boolean;
  status: 'published' | 'withdrawn';
  createdByName: string;
  publishedAt: Date;
  withdrawnAt?: Date | null;
}
export const AssignmentModel = defineTenantModel<IAssignment>(
  'Assignment',
  {
    sessionId: { type: 'ObjectId', required: true },
    sectionId: { type: 'ObjectId', required: true },
    subjectId: { type: 'ObjectId', required: true },
    staffId: { type: 'ObjectId', default: null },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    description: { type: String, required: true, maxlength: 5000 },
    instructions: { type: String, maxlength: 5000 },
    dueAt: { type: Date, required: true },
    maxMarks: { type: Number, min: 0, max: 1000, default: null },
    allowLate: { type: Boolean, default: true },
    status: { type: String, enum: ['published', 'withdrawn'], required: true, default: 'published' },
    createdByName: { type: String, required: true, maxlength: 120 },
    publishedAt: { type: Date, required: true },
    withdrawnAt: { type: Date, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, sectionId: 1, status: 1, dueAt: -1 });
    s.index({ schoolId: 1, staffId: 1, dueAt: -1 });
  },
);

export interface ISubmission {
  assignmentId: Types.ObjectId;
  studentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  text?: string;
  submittedAt: Date;
  late: boolean;
  /** how many times the student (re)submitted before it was reviewed */
  attempts: number;
  status: 'submitted' | 'reviewed';
  marks?: number | null;
  feedback?: string | null;
  reviewedAt?: Date | null;
  reviewedByName?: string | null;
}
/** One submission per student per assignment (unique index = no duplicates, even under concurrent clicks). */
export const SubmissionModel = defineTenantModel<ISubmission>(
  'Submission',
  {
    assignmentId: { type: 'ObjectId', required: true },
    studentId: { type: 'ObjectId', required: true },
    sectionId: { type: 'ObjectId', required: true },
    text: { type: String, maxlength: 10000 },
    submittedAt: { type: Date, required: true },
    late: { type: Boolean, required: true, default: false },
    attempts: { type: Number, required: true, default: 1 },
    status: { type: String, enum: ['submitted', 'reviewed'], required: true, default: 'submitted' },
    marks: { type: Number, default: null },
    feedback: { type: String, maxlength: 3000, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedByName: { type: String, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, assignmentId: 1, studentId: 1 }, { unique: true });
    s.index({ schoolId: 1, studentId: 1, submittedAt: -1 });
  },
);
