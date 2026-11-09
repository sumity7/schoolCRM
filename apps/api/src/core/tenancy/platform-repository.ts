import { Types, type Model } from 'mongoose';
import { runAsPlatform } from './context';
import { toObjectId } from './repository';

type Filter = Record<string, unknown>;

/**
 * Cross-tenant / platform-level data access. Every call states a REASON (audited by callers).
 * ESLint restricts importing this file to `modules/platform`, `modules/auth`, `modules/schools`,
 * `modules/users`, `core/*` and scripts. School-scoped modules must use TenantRepository.
 */
export class PlatformRepository<T extends object> {
  constructor(protected readonly model: Model<T>) {}

  find(filter: Filter, reason: string, opts: { sort?: Record<string, 1 | -1>; limit?: number; skip?: number } = {}) {
    return runAsPlatform(reason, async () => {
      let q = this.model.find(filter as never);
      if (opts.sort) q = q.sort(opts.sort);
      if (opts.skip) q = q.skip(opts.skip);
      if (opts.limit) q = q.limit(opts.limit);
      return (await q.lean()) as unknown as Array<T & { _id: Types.ObjectId }>;
    });
  }

  findOne(filter: Filter, reason: string) {
    return runAsPlatform(reason, async () => (await this.model.findOne(filter as never).lean()) as unknown as (T & { _id: Types.ObjectId }) | null);
  }

  findById(id: unknown, reason: string) {
    const oid = toObjectId(id);
    if (!oid) return Promise.resolve(null);
    return this.findOne({ _id: oid }, reason);
  }

  count(filter: Filter, reason: string) {
    return runAsPlatform(reason, async () => await this.model.countDocuments(filter as never));
  }

  create(doc: Partial<T> & Record<string, unknown>, reason: string) {
    return runAsPlatform(reason, async () => {
      const created = await (this.model as unknown as Model<Record<string, unknown>>).create(doc);
      return (created as unknown as { toObject(): unknown }).toObject() as unknown as T & { _id: Types.ObjectId };
    });
  }

  updateOne(filter: Filter, update: Record<string, unknown>, reason: string) {
    return runAsPlatform(reason, async () => await this.model.updateOne(filter as never, update as never));
  }

  updateMany(filter: Filter, update: Record<string, unknown>, reason: string) {
    return runAsPlatform(reason, async () => await this.model.updateMany(filter as never, update as never));
  }

  findOneAndUpdate(filter: Filter, update: Record<string, unknown>, reason: string) {
    return runAsPlatform(reason, async () => (await this.model.findOneAndUpdate(filter as never, update as never, { new: true }).lean()) as unknown as (T & { _id: Types.ObjectId }) | null);
  }

  deleteMany(filter: Filter, reason: string) {
    return runAsPlatform(reason, async () => await this.model.deleteMany(filter as never));
  }

  aggregate<R = unknown>(pipeline: Parameters<Model<T>['aggregate']>[0], reason: string) {
    return runAsPlatform(reason, async () => await this.model.aggregate<R>(pipeline));
  }
}
