/**
 * Seeds ONE synthetic demo school into the development database (npm run seed:demo). Never runs in production.
 * Login afterwards: owner@demo.test / Correct-Horse-9 (teacher: tina@demo.test). All data is fake.
 */
import { loadEnv } from '../src/config/env';
import { connectDb, disconnectDb, ensureIndexes } from '../src/core/db/connection';
import { createApp } from '../src/app';
import { createLogger } from '../src/core/logging/logger';
import { DevEmailAdapter } from '../src/core/notifications/email';
import { schools } from '../src/modules/auth/auth.repository';
import { buildSchoolData } from '../test/helpers/fixtures';

const env = loadEnv();
if (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging') throw new Error('seed:demo refuses to run outside development');
await connectDb(env.DATABASE_URL);
try {
  await ensureIndexes();
  if (await schools.findOne({ code: 'demo' }, 'seed: exists?')) {
    console.log('A school with code "demo" already exists — nothing done.');
  } else {
    const { app } = createApp({ env: { ...env, RATE_LIMIT_ENABLED: false }, logger: createLogger('warn'), email: new DevEmailAdapter(undefined, null) });
    await buildSchoolData(app, 'demo', { students: 25 });
    console.log('Demo school seeded. Log in as owner@demo.test or tina@demo.test with password Correct-Horse-9 (synthetic data).');
  }
} finally {
  await disconnectDb();
}
