import mongoose from 'mongoose';

mongoose.set('strictQuery', true);
// Lets repositories join an active transaction without threading sessions everywhere (ADR-4/doc 04 §5).
mongoose.set('transactionAsyncLocalStorage', true);

export async function connectDb(uri: string): Promise<typeof mongoose> {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, autoIndex: false, autoCreate: false });
  return mongoose;
}

/** Builds all declared indexes. Called at boot (dev/test) and by the deploy script. */
export async function ensureIndexes(): Promise<void> {
  for (const model of Object.values(mongoose.models)) {
    await model.createCollection().catch(() => undefined); // collections must exist for transactions
    await model.syncIndexes();
  }
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

/** Runs `fn` in a MongoDB transaction (requires a replica set). Repositories join it automatically. */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  return mongoose.connection.transaction(fn) as Promise<T>;
}

export function dbReady(): boolean {
  return mongoose.connection.readyState === 1;
}
