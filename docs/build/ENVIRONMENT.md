# Environment variables

All API variables are validated at boot (`apps/api/src/config/env.ts`); the process exits on invalid configuration. See `.env.example`.

| Variable | Default | Notes |
|---|---|---|
| NODE_ENV | development | `production` enforces: COOKIE_SECURE=true, non-localhost DATABASE_URL, paid-integration flags false |
| PORT | 4000 | API port |
| DATABASE_URL | mongodb://127.0.0.1:27017/edunex_dev?replicaSet=rs0 | **Replica set required** (transactions). No Atlas-only features are used (portability, doc 12 §11) |
| ALLOWED_ORIGINS | http://localhost:3000 | CSRF `Origin` allow-list for state-changing requests |
| APP_BASE_URL | http://localhost:3000 | used in emailed links |
| TRUST_PROXY_HOPS | 0 | number of trusted reverse-proxy hops (1 behind Caddy/nginx); wrong values enable IP spoofing |
| COOKIE_SECURE | false | must be true in production (uses `__Host-` cookie prefix) |
| SESSION_IDLE_MINUTES / SESSION_ABSOLUTE_DAYS / SESSION_REMEMBER_DAYS | 480 / 14 / 30 | session policy |
| LOGIN_MAX_FAILURES / LOGIN_LOCK_MINUTES | 5 / 15 | account lockout |
| RATE_LIMIT_ENABLED | true | in-memory limiter (single process) |
| EMAIL_ADAPTER | console | `console` = dev outbox (no delivery), `disabled` |
| FEATURE_ONLINE_PAYMENTS / FEATURE_SMS / FEATURE_WHATSAPP | false | **must stay false** until explicitly approved (D-28) |
| LOG_LEVEL | info | pino; credentials/tokens/cookies are redacted |
| API_ORIGIN (web) | http://localhost:4000 | Next.js rewrite target for `/api/*` (dev/staging) |
| MONGOMS_SYSTEM_BINARY (tests) | — | path to an installed mongod for tests/E2E |
| PW_CHANNEL (E2E) | — | `msedge` / `chrome` to use an installed browser |

No secrets are required for local development. Never commit `.env` files.
