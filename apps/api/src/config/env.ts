import { z } from 'zod';

/**
 * Validated configuration. The process refuses to start on missing/invalid values (doc 04 §10).
 * No secrets have defaults that would be safe in production.
 */
const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  APP_ENV_LABEL: z.string().default('DEV'), // shown in UI banner: DEV | STAGING | (empty for prod)
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1).default('mongodb://127.0.0.1:27017/edunex_dev?replicaSet=rs0'),
  /** Origins allowed to make state-changing requests (CSRF Origin check). */
  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  /** Number of trusted reverse-proxy hops (Express `trust proxy`). 0 = none. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  COOKIE_SECURE: bool.default('false'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).default(480),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).default(14),
  SESSION_REMEMBER_DAYS: z.coerce.number().int().min(1).default(30),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
  /** Public base URL used in emailed links. */
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  EMAIL_ADAPTER: z.enum(['console', 'disabled']).default('console'),
  /** Feature flags for paid/unauthorised integrations — all OFF by default (D-28). */
  FEATURE_ONLINE_PAYMENTS: bool.default('false'),
  FEATURE_SMS: bool.default('false'),
  FEATURE_WHATSAPP: bool.default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_ENABLED: bool.default('true'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${msg}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    if (env.DATABASE_URL.includes('127.0.0.1') || env.DATABASE_URL.includes('localhost')) {
      throw new Error('DATABASE_URL points at localhost in production');
    }
    if (env.FEATURE_ONLINE_PAYMENTS || env.FEATURE_SMS || env.FEATURE_WHATSAPP) {
      // Allowed only after explicit authorisation; kept as a hard stop until D-28/D-11 are lifted.
      throw new Error('Paid/unauthorised integration flags must remain false until explicitly approved');
    }
  }
  return env;
}
