import type { Types } from 'mongoose';
import { defineTenantModel } from '../../core/tenancy/registry';

export interface IAcademicSession {
  name: string;
  startDate: string; // YYYY-MM-DD in school timezone
  endDate: string;
  status: 'draft' | 'active' | 'closed';
}
/** One ACTIVE session per school is enforced by a partial unique index. Sessions are never deleted (history). */
export const AcademicSessionModel = defineTenantModel<IAcademicSession>(
  'AcademicSession',
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    status: { type: String, enum: ['draft', 'active', 'closed'], default: 'draft', required: true },
  },
  (s) => {
    s.index({ schoolId: 1, name: 1 }, { unique: true });
    s.index({ schoolId: 1 }, { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_session' });
  },
);

export interface ISchoolClass {
  sessionId: Types.ObjectId;
  name: string;
  order: number;
  stream?: string;
}
/** "Class" = grade level (data, not an enum: no hard-coded Class 1–12, D-01). */
export const SchoolClassModel = defineTenantModel<ISchoolClass>(
  'SchoolClass',
  {
    sessionId: { type: 'ObjectId', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    order: { type: Number, required: true, default: 0 },
    stream: { type: String, trim: true, maxlength: 40 },
  },
  (s) => {
    s.index({ schoolId: 1, sessionId: 1, name: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
    s.index({ schoolId: 1, sessionId: 1, order: 1 });
  },
  { softDelete: true },
);

export interface ISection {
  sessionId: Types.ObjectId;
  classId: Types.ObjectId;
  name: string;
  capacity?: number;
  classTeacherId?: Types.ObjectId | null;
  roomNo?: string;
}
export const SectionModel = defineTenantModel<ISection>(
  'Section',
  {
    sessionId: { type: 'ObjectId', required: true },
    classId: { type: 'ObjectId', required: true },
    name: { type: String, required: true, trim: true, maxlength: 30 },
    capacity: { type: Number, min: 1, max: 500 },
    classTeacherId: { type: 'ObjectId', default: null },
    roomNo: { type: String, maxlength: 20 },
  },
  (s) => {
    s.index({ schoolId: 1, sessionId: 1, classId: 1, name: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
    s.index({ schoolId: 1, classTeacherId: 1 });
  },
  { softDelete: true },
);

export interface ISubject {
  code: string;
  name: string;
  type: 'core' | 'optional' | 'co_scholastic';
}
export const SubjectModel = defineTenantModel<ISubject>(
  'Subject',
  {
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    type: { type: String, enum: ['core', 'optional', 'co_scholastic'], default: 'core', required: true },
  },
  (s) => s.index({ schoolId: 1, code: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } }),
  { softDelete: true },
);

export interface ITeacherAssignment {
  sessionId: Types.ObjectId;
  staffId: Types.ObjectId;
  sectionId: Types.ObjectId;
  subjectId?: Types.ObjectId | null;
  isClassTeacher: boolean;
}
/** Used by every teacher-scope check ("assigned" permission scope). */
export const TeacherAssignmentModel = defineTenantModel<ITeacherAssignment>(
  'TeacherAssignment',
  {
    sessionId: { type: 'ObjectId', required: true },
    staffId: { type: 'ObjectId', required: true },
    sectionId: { type: 'ObjectId', required: true },
    subjectId: { type: 'ObjectId', default: null },
    isClassTeacher: { type: Boolean, default: false },
  },
  (s) => {
    s.index({ schoolId: 1, sessionId: 1, staffId: 1, sectionId: 1, subjectId: 1 }, { unique: true });
    s.index({ schoolId: 1, sessionId: 1, sectionId: 1 });
  },
);

export interface ICalendarEvent {
  sessionId: Types.ObjectId;
  date: string;
  endDate?: string;
  type: 'holiday' | 'event' | 'exam' | 'ptm';
  title: string;
}
export const CalendarEventModel = defineTenantModel<ICalendarEvent>(
  'CalendarEvent',
  {
    sessionId: { type: 'ObjectId', required: true },
    date: { type: String, required: true },
    endDate: { type: String },
    type: { type: String, enum: ['holiday', 'event', 'exam', 'ptm'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
  },
  (s) => s.index({ schoolId: 1, sessionId: 1, date: 1 }),
);
