import { randomBytes } from 'node:crypto';
import type { Types } from 'mongoose';
import { requireTenant, runAsPlatform, runWithTenant, type TenantContext } from '../tenancy/context';
import type { Logger } from '../logging/logger';
import { JobModel, type IJob } from './job.model';

/**
 * Minimal durable job queue on MongoDB (ADR-5):
 *  - enqueue() inside a request: stamped with school + member, optional de-dup key;
 *  - a worker CLAIMS one job atomically (findOneAndUpdate) with a lease; a crashed worker's lease expires and the job
 *    is picked up again (at-least-once) — handlers must therefore be idempotent;
 *  - failures retry with exponential backoff; after maxAttempts the job is `dead` (kept for inspection);
 *  - handlers run inside the job's school TenantContext (all tenant guards apply).
 */
export type JobHandler = (payload: Record<string, unknown>, job: { id: Types.ObjectId; attempts: number }) => Promise<void>;
const handlers = new Map<string, JobHandler>();
const LEASE_MS = 60_000;
const workerId = `w-${process.pid}-${randomBytes(3).toString('hex')}`;

export function registerJobHandler(type: string, h: JobHandler): void {
  handlers.set(type, h);
}

export const JobQueue = {
  async enqueue(type: string, payload: Record<string, unknown>, opts: { key?: string; maxAttempts?: number; runAt?: Date } = {}) {
    const t = requireTenant(`jobs.enqueue.${type}`);
    try {
      return await JobModel.create({
        schoolId: t.schoolId, type, payload, status: 'queued', attempts: 0, maxAttempts: opts.maxAttempts ?? 5, runAt: opts.runAt ?? new Date(),
        key: opts.key ?? null, createdByMembership: t.membershipId, createdByUser: t.userId,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000 && opts.key) return JobModel.findOne({ schoolId: t.schoolId, key: opts.key }); // already queued
      throw err;
    }
  },

  /** Claims and runs ONE due job. Returns false when nothing is due. */
  async runOne(logger?: Logger): Promise<boolean> {
    const now = new Date();
    const job = await runAsPlatform('jobs: claim next due job', async () =>
      JobModel.findOneAndUpdate(
        { $or: [{ status: 'queued', runAt: { $lte: now } }, { status: 'running', lockedUntil: { $lt: now } }] },
        { $set: { status: 'running', lockedBy: workerId, lockedUntil: new Date(now.getTime() + LEASE_MS) }, $inc: { attempts: 1 } },
        { sort: { runAt: 1 }, new: true },
      ).lean(),
    );
    if (!job) return false;
    const ctx: TenantContext = { schoolId: (job as unknown as { schoolId: Types.ObjectId }).schoolId, membershipId: job.createdByMembership, userId: job.createdByUser, roleKeys: [], grants: new Map() };
    const handler = handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await runWithTenant(ctx, () => handler(job.payload, { id: job._id, attempts: job.attempts }));
      await runAsPlatform('jobs: mark done', async () => JobModel.updateOne({ _id: job._id, lockedBy: workerId }, { $set: { status: 'done', doneAt: new Date(), lockedUntil: null, lastError: null } }));
    } catch (err) {
      const dead = job.attempts >= job.maxAttempts;
      const backoffMs = Math.min(30 * 60_000, 2 ** job.attempts * 1000);
      const set: Partial<IJob> = dead
        ? { status: 'dead', lockedUntil: null, lastError: String((err as Error).message).slice(0, 500) }
        : { status: 'queued', runAt: new Date(Date.now() + backoffMs), lockedUntil: null, lastError: String((err as Error).message).slice(0, 500) };
      await runAsPlatform('jobs: record failure', async () => JobModel.updateOne({ _id: job._id, lockedBy: workerId }, { $set: set }));
      logger?.warn({ jobId: String(job._id), type: job.type, attempts: job.attempts, dead, err: (err as Error).message }, 'job failed');
    }
    return true;
  },

  /** Runs due jobs until none are left (tests, CLI). */
  async drain(max = 1000): Promise<number> {
    let n = 0;
    while (n < max && (await this.runOne())) n++;
    return n;
  },

  /** In-process polling worker for the API server. Returns a stop function. */
  start(logger: Logger, intervalMs = 1000): () => void {
    let stopped = false;
    let running = false;
    const timer = setInterval(async () => {
      if (stopped || running) return;
      running = true;
      try {
        while (!stopped && (await this.runOne(logger))) { /* keep going while work is due */ }
      } catch (err) {
        logger.error({ err }, 'job worker loop error');
      } finally {
        running = false;
      }
    }, intervalMs);
    timer.unref();
    return () => { stopped = true; clearInterval(timer); };
  },
};
