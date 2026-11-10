# Deployment (single VPS, ADR-2)

Audience: the operator. **Not yet performed on a real host** — no hosting, domain or managed database has been bought
(D-26/D-28). Everything below was built and smoke-tested locally (see §6). Real student data stays out until the
Production-Readiness Gate (doc 12 §10) passes.

## 1. Topology

```
Internet ──443──▶ Caddy (TLS, headers, 5 MB body cap, /health hidden)
                    ├── /api/*  ──▶ 127.0.0.1:4000  Express API   (systemd: edunex-api)
                    └── /*      ──▶ 127.0.0.1:3000  Next.js        (systemd: edunex-web)
API ──TLS──▶ managed MongoDB replica set (backups/PITR per tier) — localhost DB is refused in production
Nightly 02:30 IST: edunex-backup.timer → encrypted backup → rclone to a different provider
```
One origin for the browser: first-party cookies (`__Host-edunex_sid`, Secure, SameSite=Lax), no CORS. Both apps bind to
127.0.0.1 only; nothing but Caddy is reachable from outside (also close ports 3000/4000 in the firewall).

## 2. Files in `deploy/`

| File | Goes to |
|---|---|
| `Caddyfile` | `/etc/caddy/Caddyfile` (replace `app.example.in`) |
| `systemd/edunex-api.service`, `edunex-web.service` | `/etc/systemd/system/` |
| `systemd/edunex-backup.service`, `.timer` | `/etc/systemd/system/` (`systemctl enable --now edunex-backup.timer`) |
| `api.env.example` → `/etc/edunex/api.env` | chmod 600, every value set for your host |
| `backup.env.example` → `/etc/edunex/backup.env` | chmod 600; passphrase also in your password manager |

## 3. Production startup guards (enforced in code, tested in `kernel.test.ts`)
The API refuses to start in `NODE_ENV=production` unless: `COOKIE_SECURE=true`; `DATABASE_URL` is not localhost;
`APP_BASE_URL` and every `ALLOWED_ORIGINS` entry are `https://`; `TRUST_PROXY_HOPS ≥ 1`; payment/SMS/WhatsApp flags are
false. `HOST` defaults to `127.0.0.1`.

## 4. Build & release (on a build machine or the VPS)
```
npm ci
npm run check                                   # typecheck + lint + API tests (must pass)
npm run build --workspace @edunex/api           # → apps/api/dist/server.js, dist/cli.js (shared package bundled)
npm run build --workspace @edunex/web           # → apps/web/.next/standalone
# Next standalone does NOT include static assets — copy them, or pages load without JS/CSS:
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/public       apps/web/.next/standalone/apps/web/public   # if the folder exists
```
Release layout: `/opt/edunex/releases/<timestamp>/{apps/api (dist + node_modules --omit=dev + package.json), web (= the standalone folder)}`,
`/opt/edunex/current` → symlink to the active release (keep the last 3 for rollback).

## 5. Deploy steps (each release)
1. **Backup first:** `systemctl start edunex-backup.service` and check it succeeded.
2. Upload the release, `npm ci --omit=dev` in `apps/api`.
3. Indexes (additive only): `cd /opt/edunex/releases/<new>/apps/api && node dist/cli.js sync-indexes`.
4. Switch `current` symlink → `systemctl restart edunex-api edunex-web`.
5. Smoke: `curl -s 127.0.0.1:4000/health/ready`, open the site, log in with a test owner, open Students and Attendance.
6. **Rollback:** point `current` back to the previous release and restart. Database changes are additive (doc 12 §8),
   so the previous release still works; a destructive migration requires a verified backup and a written go decision.

First-time only: create the `edunex` system user; `/var/lib/edunex`, `/var/backups/edunex` owned by it; install Node 22
LTS, Caddy, rclone; `node dist/cli.js create-super-admin …` and `create-school …` (see SETUP.md).

## 6. What has actually been verified (2026-11-10, local Windows machine)
- `tsup` bundles of the API and CLI start and serve: health ready, login, student list; the API binds 127.0.0.1.
- Production mode refuses a localhost database and a non-https base URL (manual run) plus all guards in unit tests.
- Next.js standalone server (`outputFileTracingRoot` = repo root) serves pages and static chunks with the security headers
  and without `X-Powered-By`; `/api/*` reaches the API.
- **Not verified:** Caddy config syntax and TLS (Caddy is not installed here — run `caddy validate --config /etc/caddy/Caddyfile`
  on the server), systemd units, rclone off-site copy, Linux file permissions, the E2E suite against this topology.

## 7. Monitoring (minimum until a paid tool is approved)
- `systemctl status` / `journalctl -u edunex-api` ; Caddy access log (cookies and `token` query values are stripped).
- An external free uptime checker hitting the public login page (not `/health`, which is hidden).
- Weekly: `node dist/cli.js restore-drill --file <newest off-site copy>` and keep the JSON report (Gate G2).
