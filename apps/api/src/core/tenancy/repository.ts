import { Types, type Model, type PipelineStage, type AnyBulkWriteOperation } from 'mongoose';
import type { PageMeta } from '@edunex/shared';
import { conflict, notFound, TenantViolationError } from '../errors';
import { requireTenant } from './context';
import { modelInfo } from './registry';

export type Lean<T> = T & { _id: Types.ObjectId; schoolId: Types.ObjectId; __v: number; createdAt: Date; updatedAt: Date; createdBy?: Types.ObjectId; updatedBy?: Types.ObjectId };

export function toObjectId(id: unknown): Types.ObjectId | null {
  if (id instanceof Types.ObjectId) return id;
  if (typeof id === 'string' && /^[a-f\d]{24}$/i.test(id)) return new Types.ObjectId(id);
  return null;
}

type Filter = Record<string, unknown>;

export interface FindOptions {
  sort?: Record<string, 1 | -1>;
  skip?: number;
  limit?: number;
  select?: string | Record<string, 0 | 1>;
  includeDeleted?: boolean;
}

const PROTECTED_FIELDS = ['_id', 'schoolId', 'createdAt', 'createdBy', 'updatedAt', '__v', 'deletedAt', 'deletedBy'];

/**
 * The ONLY door to a tenant collection (doc 06, lock 2; doc 09 §2).
 * Reads tenant from TenantContext; callers never supply `schoolId`.
 * Models must not be imported outside `*.repository.ts` files (ESLint-enforced).
 */
export class TenantRepository<T extends object> {
  protected readonly softDelete: boolean;

  constructor(protected readonly model: Model<T>) {
    const info = modelInfo(model.modelName);
    if (!info || info.kind !== 'tenant') {
      throw new TenantViolationError(`${model.modelName} is not registered as a tenant model`);
    }
    this.softDelete = info.softDelete;
  }

  protected scope(filter: Filter = {}, includeDeleted = false): Filter {
    const t = requireTenant(`${this.model.modelName} query`);
    const f: Filter = { ...filter, schoolId: t.schoolId };
    if (this.softDelete && !includeDeleted && f.deletedAt === undefined) f.deletedAt = null;
    return f;
  }

  async find(filter: Filter = {}, opts: FindOptions = {}): Promise<Array<Lean<T>>> {
    let q = this.model.find(this.scope(filter, opts.includeDeleted) as never);
    if (opts.select) q = q.select(opts.select as never);
    if (opts.sort) q = q.sort(opts.sort);
    if (opts.skip) q = q.skip(opts.skip);
    if (opts.limit) q = q.limit(opts.limit);
    return (await q.lean()) as unknown as Array<Lean<T>>;
  }

  async findOne(filter: Filter, opts: FindOptions = {}): Promise<Lean<T> | null> {
    let q = this.model.findOne(this.scope(filter, opts.includeDeleted) as never);
    if (opts.select) q = q.select(opts.select as never);
    return (await q.lean()) as unknown as Lean<T> | null;
  }

  /** Invalid ids and cross-tenant ids are both simply "not found". */
  async findById(id: unknown, opts: FindOptions = {}): Promise<Lean<T> | null> {
    const oid = toObjectId(id);
    if (!oid) return null;
    return this.findOne({ _id: oid }, opts);
  }

  async getById(id: unknown, what = this.model.modelName, opts: FindOptions = {}): Promise<Lean<T>> {
    const doc = await this.findById(id, opts);
    if (!doc) throw notFound(what);
    return doc;
  }

  async findByIds(ids: unknown[], opts: FindOptions = {}): Promise<Array<Lean<T>>> {
    const oids = ids.map(toObjectId).filter((x): x is Types.ObjectId => x !== null);
    if (oids.length === 0) return [];
    return this.find({ _id: { $in: oids } }, opts);
  }

  async exists(filter: Filter): Promise<boolean> {
    const doc = await this.model.exists(this.scope(filter) as never);
    return doc !== null;
  }

  async count(filter: Filter = {}, includeDeleted = false): Promise<number> {
    return this.model.countDocuments(this.scope(filter, includeDeleted) as never);
  }

  async paginate(
    filter: Filter,
    page: number,
    limit: number,
    sort: Record<string, 1 | -1> = { _id: -1 },
    select?: FindOptions['select'],
  ): Promise<{ data: Array<Lean<T>>; meta: PageMeta }> {
    const [total, data] = await Promise.all([
      this.count(filter),
      this.find(filter, { sort, skip: (page - 1) * limit, limit, select }),
    ]);
    return { data, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  async create(data: Partial<T> & Record<string, unknown>): Promise<Lean<T>> {
    const t = requireTenant(`${this.model.modelName}.create`);
    const clean: Record<string, unknown> = { ...data };
    for (const f of PROTECTED_FIELDS) delete clean[f];
    clean.schoolId = t.schoolId;
    clean.createdBy = t.membershipId;
    clean.updatedBy = t.membershipId;
    const doc = await (this.model as unknown as Model<Record<string, unknown>>).create(clean);
    return (doc as unknown as { toObject(): unknown }).toObject() as unknown as Lean<T>;
  }

  async createMany(items: Array<Partial<T> & Record<string, unknown>>): Promise<Array<Lean<T>>> {
    const t = requireTenant(`${this.model.modelName}.createMany`);
    const rows = items.map((d) => {
      const clean: Record<string, unknown> = { ...d };
      for (const f of PROTECTED_FIELDS) delete clean[f];
      return { ...clean, schoolId: t.schoolId, createdBy: t.membershipId, updatedBy: t.membershipId };
    });
    const docs = await this.model.insertMany(rows as never[], { ordered: true });
    return docs.map((d) => (d as unknown as { toObject(): unknown }).toObject()) as unknown as Array<Lean<T>>;
  }

  /**
   * Patch by id. With `expectedVersion` performs optimistic locking (409 on stale).
   * Protected fields are stripped; `schoolId` can never change.
   */
  async updateById(id: unknown, patch: Record<string, unknown>, opts: { expectedVersion?: number; what?: string } = {}): Promise<Lean<T>> {
    const t = requireTenant(`${this.model.modelName}.update`);
    const oid = toObjectId(id);
    if (!oid) throw notFound(opts.what ?? this.model.modelName);
    const clean: Record<string, unknown> = { ...patch };
    for (const f of PROTECTED_FIELDS) delete clean[f];
    const filter = this.scope({ _id: oid, ...(opts.expectedVersion !== undefined ? { __v: opts.expectedVersion } : {}) });
    const update: Record<string, unknown> = { $set: { ...clean, updatedBy: t.membershipId } };
    if (opts.expectedVersion !== undefined) update.$inc = { __v: 1 };
    const doc = await this.model.findOneAndUpdate(filter as never, update as never, { new: true, runValidators: true }).lean();
    if (doc) return doc as unknown as Lean<T>;
    if (opts.expectedVersion !== undefined && (await this.exists({ _id: oid }))) {
      throw conflict('This record was changed by someone else. Reload and try again.');
    }
    throw notFound(opts.what ?? this.model.modelName);
  }

  async softDeleteById(id: unknown, what?: string): Promise<void> {
    if (!this.softDelete) throw new TenantViolationError(`${this.model.modelName} does not support soft delete`);
    const t = requireTenant(`${this.model.modelName}.softDelete`);
    const oid = toObjectId(id);
    if (!oid) throw notFound(what);
    const res = await this.model.updateOne(this.scope({ _id: oid }) as never, { $set: { deletedAt: new Date(), deletedBy: t.membershipId } } as never);
    if (res.matchedCount === 0) throw notFound(what);
  }

  /**
   * Permanent delete — ONLY for non-historical data (calendar events, assignments). Financial/academic history
   * must use soft delete or status transitions. Callers are reviewed for this.
   */
  async hardDeleteById(id: unknown, what?: string): Promise<void> {
    const t = requireTenant(`${this.model.modelName}.hardDelete`);
    if (t.readOnly) throw new TenantViolationError('Write attempted in a read-only (support) session');
    const oid = toObjectId(id);
    if (!oid) throw notFound(what);
    const res = await this.model.deleteOne(this.scope({ _id: oid }, true) as never);
    if (res.deletedCount === 0) throw notFound(what);
  }

  async aggregate<R = unknown>(pipeline: PipelineStage[]): Promise<R[]> {
    const t = requireTenant(`${this.model.modelName}.aggregate`);
    const base: PipelineStage[] = [{ $match: { schoolId: t.schoolId, ...(this.softDelete ? { deletedAt: null } : {}) } }];
    return this.model.aggregate<R>([...base, ...pipeline]);
  }

  /** Bulk writes are stamped and validated per operation (hooks do not cover bulkWrite). */
  async bulkWrite(ops: Array<AnyBulkWriteOperation<T>>, options: { ordered?: boolean } = { ordered: true }) {
    const t = requireTenant(`${this.model.modelName}.bulkWrite`);
    if (t.readOnly) throw new TenantViolationError('Write attempted in a read-only (support) session');
    const stamped = ops.map((raw) => {
      const op = raw as unknown as Record<string, Record<string, unknown>>;
      if (op.insertOne) {
        const doc = op.insertOne.document as Record<string, unknown>;
        if (doc.schoolId !== undefined && !t.schoolId.equals(doc.schoolId as Types.ObjectId)) throw new TenantViolationError('bulk insert targets another school');
        return { insertOne: { document: { ...doc, schoolId: t.schoolId, createdBy: t.membershipId, updatedBy: t.membershipId } } };
      }
      for (const kind of ['updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany'] as const) {
        const body = op[kind];
        if (body) {
          const filter = (body.filter ?? {}) as Record<string, unknown>;
          if (filter.schoolId !== undefined && !t.schoolId.equals(filter.schoolId as Types.ObjectId)) throw new TenantViolationError('bulk op targets another school');
          const upd = JSON.stringify(body.update ?? body.replacement ?? {});
          if (upd.includes('"schoolId"')) throw new TenantViolationError('schoolId is immutable');
          const next: Record<string, unknown> = { ...body, filter: { ...filter, schoolId: t.schoolId } };
          if (body.upsert && body.update) {
            const u = body.update as Record<string, Record<string, unknown>>;
            next.update = { ...u, $setOnInsert: { ...(u.$setOnInsert ?? {}), schoolId: t.schoolId, createdBy: t.membershipId } };
          }
          return { [kind]: next };
        }
      }
      throw new TenantViolationError('Unsupported bulk operation');
    });
    return this.model.bulkWrite(stamped as never, { ordered: options.ordered ?? true });
  }
}
