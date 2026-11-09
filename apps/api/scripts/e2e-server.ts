/**
 * E2E test server: an isolated in-memory MongoDB replica set + the real API, seeded with SYNTHETIC data.
 * Never used for anything but Playwright runs. Refuses to run in production.
 *   MONGOMS_SYSTEM_BINARY=<path to mongod> tsx scripts/e2e-server.ts
 * Logins (password for all: Correct-Horse-9):
 *   owner@alpha.test (owner), tina@alpha.test (teacher of Class 5-A), multi@x.test (admin in alpha AND bravo)
 */
if (process.env.NODE_ENV === 'production') throw new Error('e2e-server refuses to run in production');
process.env.NODE_ENV = 'test';

import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { loadEnv } from '../src/config/env';
import { connectDb, ensureIndexes } from '../src/core/db/connection';
import { createLogger } from '../src/core/logging/logger';
import { DevEmailAdapter } from '../src/core/notifications/email';
import { createApp } from '../src/app';

const systemBinary = process.env.MONGOMS_SYSTEM_BINARY;
const rs = await MongoMemoryReplSet.create({
  binary: systemBinary ? { systemBinary, checkMD5: false } : { version: process.env.MONGOMS_VERSION ?? '7.0.14' },
  replSet: { count: 1, storageEngine: 'wiredTiger' },
});
const uri = new URL(rs.getUri());
uri.pathname = '/edunex_e2e';

const env = loadEnv({
  NODE_ENV: 'test', PORT: process.env.E2E_API_PORT ?? '4100', DATABASE_URL: uri.toString(),
  ALLOWED_ORIGINS: process.env.E2E_WEB_ORIGIN ?? 'http://localhost:3100', RATE_LIMIT_ENABLED: 'false', LOG_LEVEL: 'warn',
} as NodeJS.ProcessEnv);
await connectDb(env.DATABASE_URL);
await ensureIndexes();

const { app } = createApp({ env, logger: createLogger('warn'), email: new DevEmailAdapter(undefined, null) });

// Seed through the real API (same rules as users).
const { buildSchoolData } = await import('../test/helpers/fixtures');
const { seedMember } = await import('../test/helpers/app');
const alpha = await buildSchoolData(app, 'alpha');
const bravo = await buildSchoolData(app, 'bravo');
await seedMember(alpha.school.schoolId, 'multi@x.test', ['admin'], { name: 'Multi Admin' });
await seedMember(bravo.school.schoolId, 'multi@x.test', ['admin'], { name: 'Multi Admin' });

app.listen(env.PORT, () => console.log(`E2E API ready on ${env.PORT} (synthetic data seeded)`));
process.on('SIGTERM', async () => { await rs.stop(); process.exit(0); });
process.on('SIGINT', async () => { await rs.stop(); process.exit(0); });
