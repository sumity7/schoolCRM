import { Types, type Schema, type Query, type Aggregate } from 'mongoose';
import { getStore } from './context';
import { TenantContextMissingError, TenantViolationError } from '../errors';

/**
 * Safety net (doc 06, lock 3). Even if code bypasses the repository and uses a model directly,
 * every query/aggregate/save on a tenant model is scoped to — or rejected against — the current tenant.
 * Fails CLOSED when no tenant context exists.
 */

const QUERY_OPS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'countDocuments',
  'distinct',
] as const;

function sameId(a: unknown, b: Types.ObjectId): boolean {
  if (a instanceof Types.ObjectId) return a.equals(b);
  if (typeof a === 'string') return a === b.toHexString();
  return false;
}

function updateTouchesSchoolId(update: unknown): boolean {
  if (!update || typeof update !== 'object') return false;
  if (Array.isArray(update)) return JSON.stringify(update).includes('"schoolId"');
  const u = update as Record<string, unknown>;
  if ('schoolId' in u) return true;
  for (const op of ['$set', '$setOnInsert', '$unset', '$rename', '$inc', '$push', '$addToSet']) {
    const body = u[op];
    if (body && typeof body === 'object' && 'schoolId' in (body as object)) return true;
  }
  return false;
}

export function tenantPlugin(schema: Schema): void {
  (schema as any).pre(QUERY_OPS, function (this: Query<unknown, unknown>) {
    const op = (this as any).op as string;
    const store = getStore();
    if (store?.platform) return;
    const tenant = store?.tenant;
    if (!tenant) throw new TenantContextMissingError(`${this.model.modelName}.${op}`);

    const filter = this.getFilter() as Record<string, unknown>;
    if (filter.schoolId !== undefined && !sameId(filter.schoolId, tenant.schoolId)) {
      throw new TenantViolationError(`Query on ${this.model.modelName} targets a different school than the current tenant`);
    }
    if (tenant.readOnly && ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany'].includes(op)) {
      throw new TenantViolationError('Write attempted in a read-only (support) session');
    }
    if (updateTouchesSchoolId(this.getUpdate())) {
      throw new TenantViolationError(`schoolId is immutable (${this.model.modelName})`);
    }
    this.where({ schoolId: tenant.schoolId });
  });

  schema.pre('aggregate', function (this: Aggregate<unknown>) {
    const store = getStore();
    if (store?.platform) return;
    const tenant = store?.tenant;
    if (!tenant) throw new TenantContextMissingError(`${this.model().modelName}.aggregate`);
    const pipeline = this.pipeline();
    const first = pipeline[0] as Record<string, unknown> | undefined;
    const already = first && '$match' in first && sameId((first.$match as Record<string, unknown>)?.schoolId, tenant.schoolId);
    if (!already) pipeline.unshift({ $match: { schoolId: tenant.schoolId } });
  });

  schema.pre('validate', function (this: { schoolId?: Types.ObjectId; isNew: boolean; constructor: { modelName: string } }) {
    const store = getStore();
    if (store?.platform) return;
    const tenant = store?.tenant;
    if (!tenant) throw new TenantContextMissingError(`${this.constructor.modelName}.save`);
    if (tenant.readOnly) throw new TenantViolationError('Write attempted in a read-only (support) session');
    if (this.schoolId === undefined || this.schoolId === null) {
      this.schoolId = tenant.schoolId;
    } else if (!sameId(this.schoolId, tenant.schoolId)) {
      throw new TenantViolationError(`Document for ${this.constructor.modelName} belongs to a different school than the current tenant`);
    }
  });

  schema.pre('insertMany', function (next: (err?: Error) => void, docs: unknown) {
    const store = getStore();
    if (store?.platform) return next();
    const tenant = store?.tenant;
    if (!tenant) return next(new TenantContextMissingError('insertMany'));
    if (tenant.readOnly) return next(new TenantViolationError('Write attempted in a read-only (support) session'));
    const list = Array.isArray(docs) ? docs : [docs];
    for (const d of list as Array<Record<string, unknown>>) {
      if (d.schoolId === undefined || d.schoolId === null) d.schoolId = tenant.schoolId;
      else if (!sameId(d.schoolId, tenant.schoolId)) return next(new TenantViolationError('insertMany document targets a different school'));
    }
    next();
  });
}
