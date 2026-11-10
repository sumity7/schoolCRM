import type { Types } from 'mongoose';
import { defineTenantModel } from '../../core/tenancy/registry';

export type AttendanceStatus = 'present' | 'absent' | 'late' | 'half_day' | 'excused';

export interface IAttendanceRecord {
  sessionId: Types.ObjectId;
  studentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  date: string; // YYYY-MM-DD in school timezone
  status: AttendanceStatus;
  remark?: string;
  markedBy: Types.ObjectId; // membership
  markedAt: Date;
  lastEditedBy?: Types.ObjectId;
  source: 'teacher' | 'admin' | 'import' | 'correction';
}

/** One document per student per day. The unique index is the final guard against duplicate attendance. */
export const AttendanceRecordModel = defineTenantModel<IAttendanceRecord>(
  'AttendanceRecord',
  {
    sessionId: { type: 'ObjectId', required: true },
    studentId: { type: 'ObjectId', required: true },
    sectionId: { type: 'ObjectId', required: true },
    date: { type: String, required: true },
    status: { type: String, enum: ['present', 'absent', 'late', 'half_day', 'excused'], required: true },
    remark: { type: String, maxlength: 200 },
    markedBy: { type: 'ObjectId', required: true },
    markedAt: { type: Date, required: true },
    lastEditedBy: { type: 'ObjectId' },
    source: { type: String, enum: ['teacher', 'admin', 'import', 'correction'], default: 'teacher' },
  },
  (s) => {
    s.index({ schoolId: 1, studentId: 1, date: 1 }, { unique: true });
    s.index({ schoolId: 1, sectionId: 1, date: 1 });
    s.index({ schoolId: 1, sessionId: 1, studentId: 1, date: 1 });
    // covering index for whole-school session reports (low attendance): answered from the index, no document fetch
    s.index({ schoolId: 1, sessionId: 1, date: 1, studentId: 1, status: 1 });
  },
);

export interface IAttendanceCorrection {
  attendanceRecordId?: Types.ObjectId | null;
  studentId: Types.ObjectId;
  sectionId: Types.ObjectId;
  date: string;
  from?: AttendanceStatus | null;
  to: AttendanceStatus;
  reason: string;
  requestedBy: Types.ObjectId;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: Types.ObjectId | null;
  decidedAt?: Date | null;
  decisionNote?: string;
}
export const AttendanceCorrectionModel = defineTenantModel<IAttendanceCorrection>(
  'AttendanceCorrection',
  {
    attendanceRecordId: { type: 'ObjectId', default: null },
    studentId: { type: 'ObjectId', required: true },
    sectionId: { type: 'ObjectId', required: true },
    date: { type: String, required: true },
    from: { type: String, enum: ['present', 'absent', 'late', 'half_day', 'excused'] },
    to: { type: String, enum: ['present', 'absent', 'late', 'half_day', 'excused'], required: true },
    reason: { type: String, required: true, maxlength: 300 },
    requestedBy: { type: 'ObjectId', required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', required: true },
    decidedBy: { type: 'ObjectId', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, maxlength: 300 },
  },
  (s) => {
    s.index({ schoolId: 1, status: 1, createdAt: -1 });
    s.index({ schoolId: 1, studentId: 1, date: 1 });
  },
);
