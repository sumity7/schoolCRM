import { Schema } from 'mongoose';
import { defineTenantModel } from '../../core/tenancy/registry';

export interface IRole {
  key: string;
  name: string;
  description?: string;
  isSystem: boolean;
  permissions: Array<{ key: string; scope: 'own' | 'assigned' | 'school' }>;
  templateVersion?: number;
}

/** Roles are DATA per school (system roles seeded from shared templates; custom roles later). */
export const RoleModel = defineTenantModel<IRole>(
  'Role',
  {
    key: { type: String, required: true, trim: true, maxlength: 60 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, maxlength: 300 },
    isSystem: { type: Boolean, required: true, default: false },
    permissions: {
      type: [new Schema({ key: { type: String, required: true }, scope: { type: String, enum: ['own', 'assigned', 'school'], required: true } }, { _id: false })],
      default: [],
    },
    templateVersion: Number,
  },
  (s) => {
    s.index({ schoolId: 1, key: 1 }, { unique: true });
  },
);
