import mongoose, { Schema, type Model, type SchemaDefinition } from 'mongoose';
import { tenantPlugin } from './plugin';

/**
 * Every Mongoose model must be CLASSIFIED here — tenant-owned or platform-level.
 * A test iterates mongoose.modelNames() and fails on any unclassified model (doc 06, lock 4).
 */
export type ModelKind = 'tenant' | 'platform';

export interface ModelInfo {
  kind: ModelKind;
  softDelete: boolean;
  collection: string;
}

export const modelRegistry = new Map<string, ModelInfo>();

export interface DefineOptions {
  /** Adds deletedAt/deletedBy and makes repositories hide deleted rows by default. */
  softDelete?: boolean;
}

function register<T>(name: string, kind: ModelKind, schema: Schema<T>, opts: DefineOptions): Model<T> {
  const existing = mongoose.models[name] as Model<T> | undefined;
  if (existing) return existing;
  const model = mongoose.model<T>(name, schema);
  modelRegistry.set(name, { kind, softDelete: Boolean(opts.softDelete), collection: model.collection.name });
  return model;
}

/** Tenant-owned collection: gets required immutable `schoolId`, audit fields and the enforcement plugin. */
export function defineTenantModel<T>(name: string, definition: SchemaDefinition, configure?: (s: Schema) => void, opts: DefineOptions = {}): Model<T> {
  const schema = new Schema(
    {
      ...definition,
      schoolId: { type: Schema.Types.ObjectId, required: true, immutable: true, ref: 'School' },
      createdBy: { type: Schema.Types.ObjectId },
      updatedBy: { type: Schema.Types.ObjectId },
      ...(opts.softDelete ? { deletedAt: { type: Date, default: null }, deletedBy: { type: Schema.Types.ObjectId } } : {}),
    },
    { timestamps: true },
  );
  schema.plugin(tenantPlugin);
  configure?.(schema as unknown as Schema);
  return register<T>(name, 'tenant', schema as unknown as Schema<T>, opts);
}

/** Platform-level collection (users, sessions, schools, plans …): no tenant plugin. */
export function definePlatformModel<T>(name: string, definition: SchemaDefinition, configure?: (s: Schema) => void, opts: DefineOptions = {}): Model<T> {
  const schema = new Schema(definition, { timestamps: true });
  configure?.(schema as unknown as Schema);
  return register<T>(name, 'platform', schema as unknown as Schema<T>, opts);
}

export function modelInfo(name: string): ModelInfo | undefined {
  return modelRegistry.get(name);
}

export function tenantModelNames(): string[] {
  return [...modelRegistry.entries()].filter(([, v]) => v.kind === 'tenant').map(([k]) => k);
}
