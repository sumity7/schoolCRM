import type { Types } from 'mongoose';
import { defineTenantModel } from '../../core/tenancy/registry';

export interface ITimetablePeriod { no: number; label: string; start: string; end: string; kind: 'lesson' | 'break' }

export type TimetableStatus = 'draft' | 'published' | 'archived';

/**
 * A timetable VERSION for one academic session: the period grid + the working days. Slots hang off a version.
 * Versions are never deleted: publishing archives the previously published one, so history is preserved and a
 * "what was the timetable in term 1" question always has an answer. Only DRAFT versions can be edited.
 */
export interface ITimetableVersion {
  sessionId: Types.ObjectId;
  versionNo: number;
  name: string;
  status: TimetableStatus;
  /** 1 = Monday … 7 = Sunday */
  workingDays: number[];
  periods: ITimetablePeriod[];
  basedOnVersionId?: Types.ObjectId | null;
  createdByName: string;
  publishedAt?: Date | null;
  publishedByName?: string | null;
  archivedAt?: Date | null;
}
export const TimetableVersionModel = defineTenantModel<ITimetableVersion>(
  'TimetableVersion',
  {
    sessionId: { type: 'ObjectId', required: true },
    versionNo: { type: Number, required: true, min: 1 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    status: { type: String, enum: ['draft', 'published', 'archived'], required: true, default: 'draft' },
    workingDays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
    periods: {
      type: [{ _id: false, no: { type: Number, required: true }, label: { type: String, required: true, maxlength: 40 }, start: { type: String, required: true }, end: { type: String, required: true }, kind: { type: String, enum: ['lesson', 'break'], required: true } }],
      default: [],
    },
    basedOnVersionId: { type: 'ObjectId', default: null },
    createdByName: { type: String, required: true, maxlength: 120 },
    publishedAt: { type: Date, default: null },
    publishedByName: { type: String, default: null },
    archivedAt: { type: Date, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, sessionId: 1, versionNo: 1 }, { unique: true });
    // at most ONE published timetable per session, enforced by the database (publishing is race-safe)
    s.index({ schoolId: 1, sessionId: 1 }, { unique: true, partialFilterExpression: { status: 'published' }, name: 'one_published_timetable' });
  },
);

export interface ITimetableSlot {
  versionId: Types.ObjectId;
  sessionId: Types.ObjectId;
  sectionId: Types.ObjectId;
  day: number;
  periodNo: number;
  subjectId: Types.ObjectId;
  staffId: Types.ObjectId;
  room?: string | null;
}
/**
 * One lesson. The three unique indexes ARE the conflict rules, so they hold even under concurrent edits:
 *   a class has one lesson per period · a teacher is in one place per period · a room hosts one lesson per period.
 */
export const TimetableSlotModel = defineTenantModel<ITimetableSlot>(
  'TimetableSlot',
  {
    versionId: { type: 'ObjectId', required: true },
    sessionId: { type: 'ObjectId', required: true },
    sectionId: { type: 'ObjectId', required: true },
    day: { type: Number, required: true, min: 1, max: 7 },
    periodNo: { type: Number, required: true, min: 1, max: 20 },
    subjectId: { type: 'ObjectId', required: true },
    staffId: { type: 'ObjectId', required: true },
    room: { type: String, trim: true, uppercase: true, maxlength: 30, default: null },
  },
  (s) => {
    s.index({ schoolId: 1, versionId: 1, sectionId: 1, day: 1, periodNo: 1 }, { unique: true, name: 'class_period_unique' });
    s.index({ schoolId: 1, versionId: 1, staffId: 1, day: 1, periodNo: 1 }, { unique: true, name: 'teacher_period_unique' });
    s.index({ schoolId: 1, versionId: 1, room: 1, day: 1, periodNo: 1 }, { unique: true, partialFilterExpression: { room: { $type: 'string' } }, name: 'room_period_unique' });
  },
);
