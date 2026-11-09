import type { Types } from 'mongoose';
import { defineTenantModel } from '../../core/tenancy/registry';

export interface IStaff {
  employeeId: string;
  name: string;
  phone?: string;
  email?: string;
  designation: string;
  department?: string;
  kind: 'teaching' | 'non_teaching';
  joiningDate?: string;
  status: 'active' | 'on_leave' | 'resigned' | 'terminated';
  endDate?: string;
  userId?: Types.ObjectId | null;
}

/** Staff profile (no salary data here: compensation lives in a separate restricted collection later). */
export const StaffModel = defineTenantModel<IStaff>(
  'Staff',
  {
    employeeId: { type: String, required: true, trim: true, maxlength: 30 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 20 },
    email: { type: String, trim: true, lowercase: true, maxlength: 254 },
    designation: { type: String, required: true, trim: true, maxlength: 80 },
    department: { type: String, trim: true, maxlength: 80 },
    kind: { type: String, enum: ['teaching', 'non_teaching'], required: true },
    joiningDate: { type: String },
    status: { type: String, enum: ['active', 'on_leave', 'resigned', 'terminated'], default: 'active', required: true },
    endDate: { type: String },
    userId: { type: 'ObjectId', default: null },
  },
  (s) => {
    s.index({ schoolId: 1, employeeId: 1 }, { unique: true });
    s.index({ schoolId: 1, status: 1, kind: 1 });
    s.index({ schoolId: 1, userId: 1 }, { sparse: true });
  },
);
