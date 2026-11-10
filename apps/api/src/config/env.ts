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
  /** Interface to bind. Loopback by default: in production only the reverse proxy may reach the API (ADR-2). */
  HOST: z.string().default('127.0.0.1'),
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
  /** In-process background worker (notice e-mails …). Tests drain the queue explicitly. */
  JOBS_ENABLED: bool.default('true'),
  /** Login-page demo accounts (development only). Unset = on in development, off everywhere else. Refused in production/staging. */
  DEMO_LOGIN_ENABLED: bool.optional(),
  /** Where uploaded files (homework attachments / submissions) are stored. Local disk only; NEVER inside a publicly served directory. */
  UPLOAD_DIR: z.string().optional(),
  /** Largest accepted upload, in bytes (default 5 MB; hard cap 10 MB). */
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(10 * 1024 * 1024).default(5 * 1024 * 1024),
  /** Encrypts TOTP secrets at rest. MUST be set to a long random value in production. */
  MFA_ENCRYPTION_KEY: z.string().min(16).default('dev-only-mfa-key-not-for-production'),
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
    if (!env.APP_BASE_URL.startsWith('https://')) throw new Error('APP_BASE_URL must be https:// in production');
    if (env.MFA_ENCRYPTION_KEY.startsWith('dev-only') || env.MFA_ENCRYPTION_KEY.length < 32) throw new Error('MFA_ENCRYPTION_KEY must be a random value of at least 32 characters in production');
    if (env.ALLOWED_ORIGINS.some((o) => !o.startsWith('https://'))) throw new Error('ALLOWED_ORIGINS must all be https:// in production');
    if (env.TRUST_PROXY_HOPS < 1) throw new Error('TRUST_PROXY_HOPS must be ≥ 1 in production (the API runs behind the reverse proxy)');
    if (env.FEATURE_ONLINE_PAYMENTS || env.FEATURE_SMS || env.FEATURE_WHATSAPP) {
      // Allowed only after explicit authorisation; kept as a hard stop until D-28/D-11 are lifted.
      throw new Error('Paid/unauthorised integration flags must remain false until explicitly approved');
    }
  }
  if (env.DEMO_LOGIN_ENABLED && (env.NODE_ENV === 'production' || env.NODE_ENV === 'staging')) {
    throw new Error('DEMO_LOGIN_ENABLED must not be true in production or staging');
  }
  // Server-controlled: never derived from the client. Production/staging are always off.
  return { ...env, DEMO_LOGIN_ENABLED: env.DEMO_LOGIN_ENABLED ?? env.NODE_ENV === 'development' };
}
