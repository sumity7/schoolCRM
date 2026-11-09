import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet: MongoMemoryReplSet | undefined;

/**
 * One in-memory MongoDB REPLICA SET for the whole run (ADR-4): transactions behave like production.
 * Version is pinned so tests match the production major (verify when hosting is chosen).
 */
export default async function setup() {
  // Offline/slow-network option: reuse an already-installed mongod (spawns its OWN throwaway instances on
  // random ports; it never touches a running MongoDB service). Example (PowerShell):
  //   $env:MONGOMS_SYSTEM_BINARY="C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe"
  // Otherwise the pinned version below is downloaded once (~590 MB on Windows) and cached.
  const systemBinary = process.env.MONGOMS_SYSTEM_BINARY;
  replSet = await MongoMemoryReplSet.create({
    binary: systemBinary ? { systemBinary, checkMD5: false } : { version: process.env.MONGOMS_VERSION ?? '7.0.14' },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  process.env.TEST_MONGO_URI = replSet.getUri();
  return async () => {
    await replSet?.stop();
  };
}
