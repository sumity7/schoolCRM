import { Schema, type Types } from 'mongoose';
import { defineTenantModel } from '../../core/tenancy/registry';

export type StudentStatus = 'active' | 'transferred' | 'withdrawn' | 'graduated' | 'alumni';

export interface IStudent {
  admissionNo: string;
  firstName: string;
  lastName?: string;
  /** Lower-cased, space-collapsed name for prefix search. */
  normalizedName: string;
  dob: string;
  gender?: 'm' | 'f' | 'o' | 'undisclosed';
  contact?: { phone?: string; email?: string };
  address?: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string };
  emergencyContacts: Array<{ name: string; relation: string; phone: string }>;
  status: StudentStatus;
  admissionDate: string;
  statusReason?: string;
  statusChangedOn?: string;
  currentEnrollmentId?: Types.ObjectId | null;
  importBatchId?: Types.ObjectId | null;
}

/**
 * Students are never hard-deleted: leaving = status transition (history for fees/attendance/results must survive).
 * Aadhaar, caste, religion and biometrics are intentionally NOT collected (data minimisation, D-13 default).
 */
export const StudentModel = defineTenantModel<IStudent>(
  'Student',
  {
    admissionNo: { type: String, required: true, trim: true, maxlength: 30 },
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, trim: true, maxlength: 80 },
    normalizedName: { type: String, required: true },
    dob: { type: String, required: true },
    gender: { type: String, enum: ['m', 'f', 'o', 'undisclosed'] },
    contact: { type: new Schema({ phone: { type: String, maxlength: 20 }, email: { type: String, maxlength: 254 } }, { _id: false }) },
    address: { type: new Schema({ line1: String, line2: String, city: String, state: String, postalCode: String }, { _id: false }) },
    emergencyContacts: {
      type: [new Schema({ name: { type: String, required: true, maxlength: 120 }, relation: { type: String, required: true, maxlength: 40 }, phone: { type: String, required: true, maxlength: 20 } }, { _id: false })],
      default: [],
      validate: (v: unknown[]) => v.length <= 3,
    },
    status: { type: String, enum: ['active', 'transferred', 'withdrawn', 'graduated', 'alumni'], default: 'active', required: true },
    admissionDate: { type: String, required: true },
    statusReason: { type: String, maxlength: 300 },
    statusChangedOn: { type: String },
    currentEnrollmentId: { type: 'ObjectId', default: null },
    importBatchId: { type: 'ObjectId', default: null },
  },
  (s) => {
    s.index({ schoolId: 1, admissionNo: 1 }, { unique: true });
    s.index({ schoolId: 1, status: 1, normalizedName: 1 });
    s.index({ schoolId: 1, normalizedName: 1 });
    s.index({ schoolId: 1, 'contact.phone': 1 });
    s.index({ schoolId: 1, importBatchId: 1 }, { sparse: true });
  },
);

export interface IEnrollment {
  studentId: Types.ObjectId;
  sessionId: Types.ObjectId;
  classId: Types.ObjectId;
  sectionId: Types.ObjectId;
  rollNo?: number;
  status: 'active' | 'promoted' | 'retained' | 'transferred' | 'withdrawn' | 'graduated';
  joinedOn: string;
  leftOn?: string;
}
/** One enrollment per student per session. Promotion closes the old row and creates a new one — history is immutable. */
export const EnrollmentModel = defineTenantModel<IEnrollment>(
  'Enrollment',
  {
    studentId: { type: 'ObjectId', required: true },
    sessionId: { type: 'ObjectId', required: true },
    classId: { type: 'ObjectId', required: true },
    sectionId: { type: 'ObjectId', required: true },
    rollNo: { type: Number },
    status: { type: String, enum: ['active', 'promoted', 'retained', 'transferred', 'withdrawn', 'graduated'], default: 'active', required: true },
    joinedOn: { type: String, required: true },
    leftOn: { type: String },
  },
  (s) => {
    s.index({ schoolId: 1, studentId: 1, sessionId: 1 }, { unique: true });
    s.index({ schoolId: 1, sessionId: 1, sectionId: 1, status: 1 });
    s.index({ schoolId: 1, sessionId: 1, sectionId: 1, rollNo: 1 }, { unique: true, partialFilterExpression: { rollNo: { $type: 'number' }, status: 'active' } });
  },
);

export interface IGuardian {
  name: string;
  phone: string;
  email?: string;
  occupation?: string;
  userId?: Types.ObjectId | null;
}
/** Guardians exist before (and without) a login. Phones are NOT unique: families share numbers. */
export const GuardianModel = defineTenantModel<IGuardian>(
  'Guardian',
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    occupation: { type: String, maxlength: 80 },
    userId: { type: 'ObjectId', default: null },
  },
  (s) => {
    s.index({ schoolId: 1, phone: 1 });
    s.index({ schoolId: 1, userId: 1 }, { sparse: true });
  },
  { softDelete: true },
);

export interface IStudentGuardian {
  studentId: Types.ObjectId;
  guardianId: Types.ObjectId;
  relationship: 'father' | 'mother' | 'guardian' | 'other';
  isPrimary: boolean;
  canViewFees: boolean;
  canPickup: boolean;
  portalAccess: boolean;
  verifiedAt?: Date | null;
  verifiedBy?: Types.ObjectId | null;
  endedAt?: Date | null;
}
/**
 * THE access-control link for parents (R3): a parent may see a child only through an active link that is
 * verified, has portalAccess and has not ended (e.g. custody order).
 */
export const StudentGuardianModel = defineTenantModel<IStudentGuardian>(
  'StudentGuardian',
  {
    studentId: { type: 'ObjectId', required: true },
    guardianId: { type: 'ObjectId', required: true },
    relationship: { type: String, enum: ['father', 'mother', 'guardian', 'other'], required: true },
    isPrimary: { type: Boolean, default: false },
    canViewFees: { type: Boolean, default: true },
    canPickup: { type: Boolean, default: true },
    portalAccess: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: 'ObjectId', default: null },
    endedAt: { type: Date, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, studentId: 1, guardianId: 1 }, { unique: true });
    s.index({ schoolId: 1, guardianId: 1 });
  },
);
