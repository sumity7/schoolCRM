import { Schema, type Types } from 'mongoose';
import { definePlatformModel } from '../../core/tenancy/registry';

export type SchoolStatus = 'requested' | 'approved' | 'onboarding' | 'live' | 'suspended' | 'deactivated';

export interface SchoolSettings {
  timezone: string;
  currency: string;
  language: string;
  dateFormat: string;
  /** ISO weekdays (1=Mon … 7=Sun) on which the school operates. */
  workingDays: number[];
  /** Month (1–12) in which the academic year starts; configurable, default April (D-01: no hard-coding). */
  academicYearStartMonth: number;
  themeColor: string;
  attendancePolicy: {
    /** Teachers may edit their own marks until the end of this many days after the date (0 = same day only). */
    teacherEditWindowDays: number;
    lateCountsAsPresent: boolean;
    halfDayWeight: number;
    lowAttendanceThresholdPct: number;
  };
  /** What portal users may see (configurable guardian/student access policy). Missing on older schools → defaults. */
  portalPolicy?: Partial<import('./school.defaults').PortalPolicy>;
}


export interface ISchool {
  _id?: Types.ObjectId;
  name: string;
  code: string;
  type: 'primary' | 'secondary' | 'senior_secondary' | 'k12' | 'other';
  board?: string;
  address: { line1?: string; line2?: string; city?: string; state?: string; postalCode?: string };
  officialEmail?: string;
  phone?: string;
  website?: string;
  owner?: { name: string; email?: string; phone?: string };
  status: SchoolStatus;
  settings: SchoolSettings;
  /** Entitlement limits set by platform CLI/console until plans exist (doc 10, entitlement-lite). */
  limits: { students: number; staff: number };
  createdAt?: Date;
  updatedAt?: Date;
}

/** The tenant root. Its `_id` IS the schoolId. Platform-level (not tenant-scoped itself). */
export const SchoolModel = definePlatformModel<ISchool>(
  'School',
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    code: { type: String, required: true, lowercase: true, trim: true, match: /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/ },
    type: { type: String, enum: ['primary', 'secondary', 'senior_secondary', 'k12', 'other'], default: 'k12' },
    board: { type: String, trim: true, maxlength: 60 },
    address: { type: new Schema({ line1: String, line2: String, city: String, state: String, postalCode: String }, { _id: false }), default: {} },
    officialEmail: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    website: { type: String, trim: true },
    owner: { type: new Schema({ name: String, email: String, phone: String }, { _id: false }) },
    status: { type: String, enum: ['requested', 'approved', 'onboarding', 'live', 'suspended', 'deactivated'], default: 'onboarding', required: true },
    settings: { type: Schema.Types.Mixed, required: true },
    limits: { type: new Schema({ students: Number, staff: Number }, { _id: false }), default: { students: 2000, staff: 200 } },
  },
  (s) => {
    s.index({ code: 1 }, { unique: true });
    s.index({ status: 1 });
  },
);
