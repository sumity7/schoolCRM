/**
 * Starts a persistent single-node MongoDB REPLICA SET for local development (zero cost, no Docker).
 * Data lives in apps/api/.data/mongo (git-ignored). Transactions work because it is a replica set.
 *   URI: mongodb://127.0.0.1:27017/edunex_dev?replicaSet=rs0
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const dbPath = join(process.cwd(), '.data', 'mongo');
mkdirSync(dbPath, { recursive: true });

const rs = await MongoMemoryReplSet.create({
  binary: { version: process.env.MONGOMS_VERSION ?? '7.0.14' },
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger', dbName: 'edunex_dev' },
  instanceOpts: [{ port: 27017, dbPath, storageEngine: 'wiredTiger' }],
});
console.log(`Dev MongoDB replica set running.\n  DATABASE_URL=mongodb://127.0.0.1:27017/edunex_dev?replicaSet=rs0\n  data: ${dbPath}\nPress Ctrl+C to stop.`);

const stop = async () => {
  await rs.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => undefined, 1 << 30);
