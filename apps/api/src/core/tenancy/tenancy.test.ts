import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose, { Types } from 'mongoose';
import { defineTenantModel, definePlatformModel, modelRegistry } from './registry';
import { TenantRepository } from './repository';
import { PlatformRepository } from './platform-repository';
import { runWithTenant } from './context';
import { TenantContextMissingError, TenantViolationError } from '../errors';
import { withTransaction } from '../db/connection';
import { setupTestDb, teardownTestDb, clearAll } from '../../../test/helpers/db';
import { makeCtx } from '../../../test/helpers/tenant';

interface IWidget { name: string; qty: number }
const WidgetModel = defineTenantModel<IWidget>(
  'TestWidget',
  { name: { type: String, required: true }, qty: { type: Number, default: 0 } },
  (s) => s.index({ schoolId: 1, name: 1 }, { unique: true }),
  { softDelete: true },
);
const PlatformThing = definePlatformModel<{ label: string }>('TestPlatformThing', { label: String });

const widgets = new TenantRepository<IWidget>(WidgetModel);
const A = makeCtx();
const B = makeCtx();

beforeAll(setupTestDb);
afterAll(teardownTestDb);
beforeEach(clearAll);

describe('REQ-TEN lock 3 — plugin fails closed without tenant context', () => {
  it('rejects find / findOne / count / update / delete', async () => {
    await expect(WidgetModel.find({})).rejects.toBeInstanceOf(TenantContextMissingError);
    await expect(WidgetModel.findOne({})).rejects.toBeInstanceOf(TenantContextMissingError);
    await expect(WidgetModel.countDocuments({})).rejects.toBeInstanceOf(TenantContextMissingError);
    await expect(WidgetModel.updateMany({}, { $set: { qty: 1 } })).rejects.toBeInstanceOf(TenantContextMissingError);
    await expect(WidgetModel.deleteMany({})).rejects.toBeInstanceOf(TenantContextMissingError);
  });
  it('rejects aggregate, save and insertMany', async () => {
    await expect(WidgetModel.aggregate([{ $match: {} }])).rejects.toBeInstanceOf(TenantContextMissingError);
    await expect(new WidgetModel({ name: 'x', schoolId: A.schoolId }).save()).rejects.toBeInstanceOf(TenantContextMissingError);
    await expect(WidgetModel.insertMany([{ name: 'x', schoolId: A.schoolId }])).rejects.toBeInstanceOf(TenantContextMissingError);
  });
  it('repository refuses to run with no context', async () => {
    await expect(widgets.find()).rejects.toBeInstanceOf(TenantContextMissingError);
    await expect(widgets.create({ name: 'x' })).rejects.toBeInstanceOf(TenantContextMissingError);
  });
});

describe('REQ-TEN lock 2 — repository scoping', () => {
  it('School B cannot see, count, fetch, update or delete School A records', async () => {
    const a = await runWithTenant(A, () => widgets.create({ name: 'pen', qty: 3 }));
    await runWithTenant(A, () => widgets.create({ name: 'ink', qty: 1 }));

    await runWithTenant(B, async () => {
      expect(await widgets.find()).toHaveLength(0);
      expect(await widgets.count()).toBe(0);
      expect(await widgets.findById(a._id)).toBeNull();
      await expect(widgets.getById(a._id)).rejects.toMatchObject({ status: 404 });
      await expect(widgets.updateById(a._id, { qty: 99 })).rejects.toMatchObject({ status: 404 });
      await expect(widgets.softDeleteById(a._id)).rejects.toMatchObject({ status: 404 });
    });
    const still = await runWithTenant(A, () => widgets.getById(a._id));
    expect(still.qty).toBe(3);
  });

  it('same unique value may exist in two schools', async () => {
    await runWithTenant(A, () => widgets.create({ name: 'same' }));
    await expect(runWithTenant(B, () => widgets.create({ name: 'same' }))).resolves.toBeTruthy();
    await expect(runWithTenant(A, () => widgets.create({ name: 'same' }))).rejects.toBeTruthy();
  });

  it('payload schoolId / protected fields are ignored on create and update', async () => {
    const doc = await runWithTenant(A, () => widgets.create({ name: 'w', schoolId: B.schoolId, createdBy: new Types.ObjectId() } as never));
    expect(doc.schoolId.equals(A.schoolId)).toBe(true);
    expect(doc.createdBy?.toString()).toBe(A.membershipId.toString());
    const upd = await runWithTenant(A, () => widgets.updateById(doc._id, { qty: 5, schoolId: B.schoolId }));
    expect(upd.schoolId.equals(A.schoolId)).toBe(true);
    expect(upd.qty).toBe(5);
  });

  it('paginates with correct totals and only own rows', async () => {
    await runWithTenant(A, async () => {
      for (let i = 0; i < 7; i++) await widgets.create({ name: `w${i}` });
    });
    await runWithTenant(B, () => widgets.create({ name: 'other' }));
    const page = await runWithTenant(A, () => widgets.paginate({}, 2, 3, { name: 1 }));
    expect(page.meta).toEqual({ page: 2, limit: 3, total: 7, totalPages: 3 });
    expect(page.data.map((d) => d.name)).toEqual(['w3', 'w4', 'w5']);
  });

  it('soft delete hides records from reads but keeps them stored', async () => {
    const w = await runWithTenant(A, () => widgets.create({ name: 'gone' }));
    await runWithTenant(A, () => widgets.softDeleteById(w._id));
    expect(await runWithTenant(A, () => widgets.findById(w._id))).toBeNull();
    expect(await runWithTenant(A, () => widgets.findById(w._id, { includeDeleted: true }))).toBeTruthy();
  });

  it('optimistic locking: stale version → 409', async () => {
    const w = await runWithTenant(A, () => widgets.create({ name: 'v' }));
    const u1 = await runWithTenant(A, () => widgets.updateById(w._id, { qty: 1 }, { expectedVersion: w.__v }));
    expect(u1.__v).toBe(w.__v + 1);
    await expect(runWithTenant(A, () => widgets.updateById(w._id, { qty: 2 }, { expectedVersion: w.__v }))).rejects.toMatchObject({ status: 409 });
  });

  it('aggregate is tenant-scoped', async () => {
    await runWithTenant(A, async () => { await widgets.create({ name: 'a', qty: 2 }); await widgets.create({ name: 'b', qty: 3 }); });
    await runWithTenant(B, () => widgets.create({ name: 'c', qty: 100 }));
    const r = await runWithTenant(A, () => widgets.aggregate<{ _id: null; total: number }>([{ $group: { _id: null, total: { $sum: '$qty' } } }]));
    expect(r[0]?.total).toBe(5);
  });

  it('bulkWrite stamps own school and rejects foreign schoolId', async () => {
    await runWithTenant(A, () => widgets.bulkWrite([{ insertOne: { document: { name: 'bulk1' } as never } }]));
    const own = await runWithTenant(A, () => widgets.find());
    expect(own.map((d) => d.name)).toEqual(['bulk1']);
    await expect(
      runWithTenant(A, () => widgets.bulkWrite([{ insertOne: { document: { name: 'evil', schoolId: B.schoolId } as never } }])),
    ).rejects.toBeInstanceOf(TenantViolationError);
    await expect(
      runWithTenant(A, () => widgets.bulkWrite([{ updateOne: { filter: { schoolId: B.schoolId }, update: { $set: { qty: 1 } } } }])),
    ).rejects.toBeInstanceOf(TenantViolationError);
    // B's data cannot be updated through A's bulk filter even without explicit schoolId
    await runWithTenant(B, () => widgets.create({ name: 'bwidget', qty: 1 }));
    await runWithTenant(A, () => widgets.bulkWrite([{ updateMany: { filter: { name: 'bwidget' }, update: { $set: { qty: 777 } } } }]));
    expect((await runWithTenant(B, () => widgets.findOne({ name: 'bwidget' })))?.qty).toBe(1);
  });
});

describe('REQ-TEN lock 3 — direct model use is still scoped or rejected', () => {
  it('direct find inside tenant A only returns A', async () => {
    await runWithTenant(A, () => widgets.create({ name: 'mine' }));
    await runWithTenant(B, () => widgets.create({ name: 'theirs' }));
    // awaited INSIDE the scope: a lazy Query that escapes runWithTenant fails closed (see next test)
    const rows = await runWithTenant(A, async () => await WidgetModel.find({}).lean());
    expect(rows.map((r) => r.name)).toEqual(['mine']);
  });
  it('a lazy query that escapes the tenant scope before execution fails closed', async () => {
    const lazy = runWithTenant(A, () => WidgetModel.find({}).lean()); // not awaited inside the scope
    await expect(lazy).rejects.toBeInstanceOf(TenantContextMissingError);
  });
  it('explicit foreign schoolId in a filter throws', async () => {
    await expect(runWithTenant(A, () => WidgetModel.find({ schoolId: B.schoolId }))).rejects.toBeInstanceOf(TenantViolationError);
    await expect(runWithTenant(A, () => WidgetModel.find({ schoolId: { $ne: A.schoolId } } as never))).rejects.toBeInstanceOf(TenantViolationError);
  });
  it('saving a document that belongs to another school throws', async () => {
    await expect(runWithTenant(A, () => new WidgetModel({ name: 'x', schoolId: B.schoolId }).save())).rejects.toBeInstanceOf(TenantViolationError);
    await expect(runWithTenant(A, () => WidgetModel.insertMany([{ name: 'x', schoolId: B.schoolId }]))).rejects.toBeInstanceOf(TenantViolationError);
  });
  it('updates that try to change schoolId throw', async () => {
    const w = await runWithTenant(A, () => widgets.create({ name: 'immut' }));
    await expect(runWithTenant(A, () => WidgetModel.updateOne({ _id: w._id }, { $set: { schoolId: B.schoolId } }))).rejects.toBeInstanceOf(TenantViolationError);
  });
  it('read-only (support) contexts cannot write', async () => {
    const RO = makeCtx(A.schoolId, { readOnly: true });
    await expect(runWithTenant(RO, () => widgets.create({ name: 'nope' }))).rejects.toBeInstanceOf(TenantViolationError);
    await expect(runWithTenant(RO, () => WidgetModel.updateMany({}, { $set: { qty: 1 } }))).rejects.toBeInstanceOf(TenantViolationError);
    await expect(runWithTenant(RO, () => widgets.find())).resolves.toEqual([]);
  });
});

describe('REQ-TEN lock 4 — classification & platform separation', () => {
  it('every registered Mongoose model is classified tenant|platform', () => {
    for (const name of mongoose.modelNames()) {
      expect(modelRegistry.has(name), `model ${name} is not classified`).toBe(true);
    }
  });
  it('every tenant model has required, immutable schoolId and indexes lead with schoolId', () => {
    for (const [name, info] of modelRegistry) {
      if (info.kind !== 'tenant') continue;
      const m = mongoose.models[name]!;
      const path = m.schema.path('schoolId') as unknown as { isRequired: boolean; options: { immutable?: boolean } };
      expect(path.isRequired, `${name}.schoolId required`).toBe(true);
      expect(path.options.immutable, `${name}.schoolId immutable`).toBe(true);
      for (const [fields] of m.schema.indexes()) {
        const first = Object.keys(fields)[0];
        if (['createdAt', 'userId'].includes(first!) && name === 'Membership') continue; // login lookup index (reviewed)
        if (first === 'createdAt' && name === 'IdempotencyKey') continue; // TTL index
        expect(first, `${name} index ${JSON.stringify(fields)} must lead with schoolId`).toBe('schoolId');
      }
    }
  });
  it('tenant repository refuses platform models', () => {
    expect(() => new TenantRepository(PlatformThing as never)).toThrow(TenantViolationError);
  });
  it('PlatformRepository can read across tenants only with a reason', async () => {
    await runWithTenant(A, () => widgets.create({ name: 'pa' }));
    await runWithTenant(B, () => widgets.create({ name: 'pb' }));
    const repo = new PlatformRepository<IWidget>(WidgetModel);
    const all = await repo.find({}, 'test: cross-tenant read');
    expect(all.length).toBe(2);
    expect(() => repo.find({}, '')).toThrow(/reason/);
  });
});

describe('transactions', () => {
  it('rolls back all writes when the callback throws, commits otherwise', async () => {
    await expect(
      runWithTenant(A, () =>
        withTransaction(async () => {
          await widgets.create({ name: 't1' });
          await widgets.create({ name: 't2' });
          throw new Error('boom');
        }),
      ),
    ).rejects.toThrow('boom');
    expect(await runWithTenant(A, () => widgets.count())).toBe(0);

    await runWithTenant(A, () => withTransaction(async () => { await widgets.create({ name: 't3' }); }));
    expect(await runWithTenant(A, () => widgets.count())).toBe(1);
  });
});
