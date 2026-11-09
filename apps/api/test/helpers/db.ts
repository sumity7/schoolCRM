import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { connectDb, ensureIndexes } from '../../src/core/db/connection';

let dbName = '';

/** Connects to a fresh per-file database inside the shared in-memory replica set. */
export async function setupTestDb(): Promise<void> {
  const base = process.env.TEST_MONGO_URI;
  if (!base) throw new Error('TEST_MONGO_URI not set — global setup did not run');
  dbName = `t_${randomBytes(6).toString('hex')}`;
  const url = new URL(base);
  url.pathname = `/${dbName}`;
  await connectDb(url.toString());
  await ensureIndexes();
}

export async function teardownTestDb(): Promise<void> {
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
}

/** Clears all data but keeps indexes (fast reset between tests). */
export async function clearAll(): Promise<void> {
  const cols = await mongoose.connection.db!.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
}
