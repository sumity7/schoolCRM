# Public demo deployment — Vercel (web) + Render (API)

A **public demo** shows the login-page demo cards (role cards that fill `owner@demo.test` / `Correct-Horse-9` …).
Because those credentials are public, a demo deployment must use **its own demo-only database with synthetic data**.
Never point a demo deployment at a database that holds (or will hold) a real school's data.

A normal production deployment is unchanged: without the two demo flags below the cards are compiled out of the web bundle
and the API refuses to start with `DEMO_LOGIN_ENABLED=true`.

## Render — API (`apps/api`)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DEPLOYMENT_MODE` | `demo` |
| `DEMO_LOGIN_ENABLED` | `true` |
| `HOST` | `0.0.0.0` (**required** — the default `127.0.0.1` is unreachable for Render's router) |
| `PORT` | leave unset (Render provides it) |
| `DATABASE_URL` | your **demo** Atlas URL, e.g. `mongodb+srv://USER:PASSWORD@cluster0.xxxx.mongodb.net/edunex_demo?retryWrites=true&w=majority` |
| `COOKIE_SECURE` | `true` |
| `APP_BASE_URL` | `https://YOUR-APP.vercel.app` |
| `ALLOWED_ORIGINS` | `https://YOUR-APP.vercel.app` (comma-separate if you add a custom domain) |
| `TRUST_PROXY_HOPS` | `1` (minimum allowed in production) |
| `MFA_ENCRYPTION_KEY` | a random value of 32+ characters — generate once, keep it (changing it invalidates enrolled authenticator apps) |
| `EMAIL_ADAPTER` | `console` (no e-mail provider configured) |
| `FEATURE_ONLINE_PAYMENTS` / `FEATURE_SMS` / `FEATURE_WHATSAPP` | `false` |

- Build command: `npm ci && npm run build --workspace @edunex/api` · Start command: `node apps/api/dist/server.js`
  (or `npm run start --workspace @edunex/api`). Health check path: `/health/ready`.
- Indexes: production does not create indexes at start-up; run once against the demo database:
  `npm run cli --workspace @edunex/api -- sync-indexes` (from your PC with the demo `DATABASE_URL`, or a Render shell).
- Demo accounts: run `npm run seed:demo --workspace @edunex/api` once against the demo database (allowed only because
  `DEPLOYMENT_MODE=demo`; it refuses on a standard production deployment). It is idempotent.
- Free tier note: Render's free instance sleeps after ~15 min idle (first request then takes 30–60 s) and its disk is
  temporary — homework uploads are lost on restart/redeploy.

## Vercel — web (`apps/web`)

| Variable | Value |
|---|---|
| `API_ORIGIN` | `https://YOUR-API.onrender.com` (no trailing slash; read at **build** time for the `/api/*` rewrite) |
| `NEXT_PUBLIC_DEMO_MODE` | `true` (build-time: keeps the demo cards and shows a "DEMO — fake data" banner on every page) |

- Root directory: `apps/web` (monorepo; install from the repo root so `@edunex/shared` resolves).
- After changing either variable, **redeploy** — both are baked into the build.
- The browser talks only to the Vercel URL; `/api/*` is proxied to Render, so session cookies stay first-party.

## Check after deploying

1. `https://YOUR-API.onrender.com/health/ready` → `{"status":"ready"}`.
2. `https://YOUR-APP.vercel.app/api/v1/auth/demo-accounts` → JSON list with `"available": true` entries
   (404 = API not in demo mode; `available: false` = run `seed:demo` against that database).
3. Login page shows the yellow DEMO banner and the "Try EduNex ERP Demo" cards.
