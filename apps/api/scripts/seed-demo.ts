/**
 * Seeds the synthetic DEMO school and demo logins into the DEVELOPMENT database (npm run seed:demo). Idempotent and
 * additive: safe to run repeatedly against an existing database; never deletes or changes existing data. Refuses to run
 * in production/staging. All data is fake. The demo password is public (Correct-Horse-9) — that is why this is dev-only.
 *
 *   owner@demo.test · tina@demo.test · accountant@demo.test · parent@demo.test · demo-a1@demo.student · root@demo.test
 */
import { loadEnv } from '../src/config/env';
import { connectDb, disconnectDb, ensureIndexes } from '../src/core/db/connection';
import { createApp } from '../src/app';
import { createLogger } from '../src/core/logging/logger';
import { DevEmailAdapter } from '../src/core/notifications/email';
import { DEMO_PASSWORD } from '../src/modules/auth/demo-accounts';
import { ensureDemoAccounts } from './lib/demo-seed';

const env = loadEnv();
if (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') throw new Error('seed:demo refuses to run outside development');
await connectDb(env.DATABASE_URL);
try {
  await ensureIndexes();
  const { app } = createApp({ env: { ...env, RATE_LIMIT_ENABLED: false }, logger: createLogger('warn'), email: new DevEmailAdapter(undefined, null) });
  const res = await ensureDemoAccounts(app);
  for (const c of res.created) console.log(`created : ${c}`);
  for (const c of res.existing) console.log(`existing: ${c}`);
  console.log(`Demo password for every account: ${DEMO_PASSWORD} (synthetic data, development only).`);
} finally {
  await disconnectDb();
}
