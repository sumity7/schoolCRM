import { loadEnv } from './config/env';
import { createLogger } from './core/logging/logger';
import { connectDb, disconnectDb, ensureIndexes } from './core/db/connection';
import { DevEmailAdapter, DisabledEmailAdapter } from './core/notifications/email';
import { createApp } from './app';
import { JobQueue } from './core/jobs/job-queue';

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL);
  await connectDb(env.DATABASE_URL);
  if (env.NODE_ENV !== 'production') await ensureIndexes(); // production runs `npm run cli -- sync-indexes` as a deploy step
  const email = env.EMAIL_ADAPTER === 'disabled' ? new DisabledEmailAdapter() : new DevEmailAdapter(logger);
  const { app } = createApp({ env, logger, email });
  const server = app.listen(env.PORT, env.HOST, () => logger.info({ host: env.HOST, port: env.PORT, env: env.NODE_ENV, label: env.APP_ENV_LABEL }, 'EduNex API listening'));

  const stopJobs = env.JOBS_ENABLED && env.NODE_ENV !== 'test' ? JobQueue.start(logger) : () => undefined;
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopJobs();
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
