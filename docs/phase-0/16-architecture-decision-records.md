# P. Architecture Decision Records (ADRs) — D-23 is CONDITIONAL

**Status of every ADR below: PROPOSED — not approved.** You asked for the exact choice, rationale, trade-offs and implementation consequences before approving. Each ADR ends with my recommendation; you approve, change or reject each one individually. Nothing is built on an ADR until it is approved (ADR-5 and ADR-6 are additionally *deferred and spike-gated*; they are designed now so earlier phases don't paint us into a corner).

| ADR | Topic | Needed by | Recommendation |
|---|---|---|---|
| 1 | Server-side sessions | Phase 3 | Approve |
| 2 | Next.js → Express same-origin routing | Phase 2 | Approve (with the dev/prod split described) |
| 3 | Shared MongoDB with `schoolId` | Phase 3 | Approve |
| 4 | Vitest (+ Supertest, Playwright, memory-server replica set) | Phase 2 | Approve |
| 5 | MongoDB-backed job queue | **R3 (Phase 9)** — designed now, implemented later | Approve the *design*; re-confirm at R3 start |
| 6 | pdfmake for PDFs | **R2 (Phase 8)** — spike-gated | Approve *conditionally on a 4–6 h spike* |
| 7 | Authentication & tenancy implementation order | Phase 3 | Approve |

Template per ADR: **Decision · Why · Alternatives · Trade-offs · Implementation consequences · Risks & mitigations · Revisit trigger · Required tests.**

---

## ADR-1 — Server-side sessions with opaque cookies

**Decision.** After login the API sets one cookie holding a 256-bit random token (`__Host-edunex_sid` in production — requires `Secure`, `Path=/`, no `Domain`; plain `edunex_sid` on `http://localhost` dev). Attributes: `HttpOnly; Secure; SameSite=Lax`. The database stores only `SHA-256(token)` in `sessions` with `userId, activeMembershipId, createdAt, lastSeenAt, expiresAt, revokedAt, ip, userAgent`. No JWTs anywhere. Idle and absolute lifetimes are configuration (proposed starting point: idle 60 min / absolute 14 days with "keep me signed in", with a longer idle option for teachers' phones — values set in Phase 3, not architectural).

**Why.** School staff change roles and leave; accounts get compromised. Server-side sessions give **instant** revocation (logout-all, suspension, password reset, role change) and **no token claims to go stale**. Simpler than JWT + refresh rotation + denylist for a solo developer, with fewer security mistakes available.

**Alternatives.** JWT access + rotating refresh (stateless reads but revocation needs a store anyway); a third-party auth service/library (adds dependency and vendor coupling; revisit if we need SSO/OTP later).

**Trade-offs.** One or two indexed DB reads per request (session → membership/roles) — fine at our scale, measured in Phase 7; no in-process caching at first (caching would weaken instant revocation). Stateful: sessions collection and cleanup (TTL index). CSRF protection is required because cookies are ambient credentials.

**Implementation consequences.**
- **CSRF design (explicit):** `SameSite=Lax` + reject mutating requests unless `Origin`/`Sec-Fetch-Site` is same-origin + require a custom header (`X-Requested-With: edunex`) + accept only `application/json` bodies (no form posts). GET never mutates. Webhooks exempt but signature-verified.
- **Server-side rendering:** Next.js server components/route handlers that call the API must forward the incoming `Cookie` header (via `cookies()`); we need one API client wrapper for browser and one for server, both tested.
- **Multi-tab / multi-school hazard:** the active school lives in the session, so switching school in tab B changes tab A's server-side context. Mitigation: every UI request carries `X-Active-Membership: <id>` as a **consistency assertion only** (never a source of authority, never `schoolId`); if it differs from the session's active membership the API returns `409 TENANT_CONTEXT_CHANGED` and the UI reloads. Tenant still comes only from the session.
- Express `trust proxy` configured for the exact proxy hop count so client IP (rate limiting, session metadata) can't be spoofed via `X-Forwarded-For`.
- Login throttling keyed by normalised identifier **and** IP; generic error messages.
- Session rotation on login and on privilege change; revoke-all on password reset.

**Risks & mitigations.** Session-store outage = full outage (same DB as everything else, accepted). Session fixation → new token on login. Mis-set cookie flags → asserted in tests and a deploy smoke check.

**Revisit trigger.** Need for mobile apps/third-party API clients, SSO, or a request rate that makes session reads a bottleneck.

**Required tests.** Unit: token generation/hash; API: login/logout/revoke-all/expiry/idle timeout/deactivated membership/rotation; cookie-flag assertions; log-grep proving no token logged. **Playwright (mandatory, doc 11 §2.1):** login + session persistence across reload/new tab, logout invalidation, CSRF forged-origin attempt rejected, tenant-switch + stale-tab 409.

**Recommendation: Approve.**

---

## ADR-2 — Next.js proxies to Express (same-origin API)

**Decision.** The browser talks to **one origin**. `/api/*` goes to Express; everything else to Next.js.
- **Dev/staging:** `next.config` `rewrites()` forwards `/api/:path*` to `API_ORIGIN`.
- **Production:** a small reverse proxy (Caddy or nginx on the same VPS) routes `/api/*` → Express and `/` → Next.js **directly**, avoiding an extra hop through Next. Behaviour must be identical in both; the E2E suite runs against the production-style topology in CI where feasible.

**Why.** Cookies stay first-party (`SameSite=Lax`, `__Host-` prefix work); **no CORS** is needed so cross-origin requests can be denied outright (smaller attack surface); the same design works with or without a custom domain (localhost now, domain later), so it fits D-28 (no spending yet).

**Alternatives.** Separate origins with CORS + `SameSite=None` cookies (third-party-cookie blocking breaks login — rejected); Next.js route handlers only, dropping Express (simpler ops but contradicts your stack choice; kept as a fallback if two-process ops hurts); API on a sibling subdomain (works only with an owned domain).

**Trade-offs.** Two processes to run and monitor; dev rewrite ≠ prod proxy (risk of divergence); an extra proxy component to configure.

**Implementation consequences.**
- Express must be reachable **only** through the proxy (bind to localhost/private network, firewall) — otherwise attackers can bypass the proxy and spoof `X-Forwarded-*`.
- Body size/timeouts set at proxy *and* Express; webhook routes need the raw body intact (R2+ payments); **file-upload size limits through Next rewrites need verifying** (R2+); prod proxy avoids the question.
- CORS middleware configured to deny by default (kept only for future explicit allow-list).
- Health check path through the proxy; streaming responses (PDF) must not be buffered into memory.

**Risks & mitigations.** Misconfigured trusted-proxy count → wrong client IP: tested with spoofed header. Divergent topologies: one `docs/topology.md`, CI smoke test hitting `/api/v1/health/ready` through the proxy.

**Revisit trigger.** Mobile app/third-party clients (then CORS + token auth needed), or ops cost of two processes proves too high.

**Required tests.** Playwright through the proxy (login cookie set/forwarded); spoofed `X-Forwarded-For` ignored; direct-to-Express access blocked in staging config; Origin check behaviour behind proxy.

**Recommendation: Approve.**

---

## ADR-3 — Shared MongoDB, shared collections, `schoolId` on every tenant record

**Decision.** One database; every tenant-owned document has required `schoolId`; compound indexes and unique constraints begin with `schoolId`. Enforcement is the seven-lock design in doc 06: server-only tenant context, `TenantRepository` as sole DB access, Mongoose plugin safety net that throws on unscoped queries, ESLint import/param rules, schema-classification test, cross-reference validation, tenant-keyed files, and a CI harness that attacks every route.

**Why.** Lowest cost and operational load (one DB, one migration path, works on small tiers), simple analytics and platform queries, and the only model that fits a ₹0-to-small budget. Risk is developer error, which the locks and tests target.

**Alternatives.** Database-per-tenant (stronger separation, but connection/migration/cost multiplication; keep as a future "dedicated deployment" offer); collection-per-tenant (index/collection explosion).

**Trade-offs.** Logical (not physical) isolation — a code defect can leak data; noisy-neighbour effects; **tenant-level backup/restore/purge is harder** than with per-tenant databases (a full backup contains everyone).

**Implementation consequences.**
- A **collection registry** (which models are tenant-owned) used by lint test, export, purge and restore tooling.
- Scripts `tenant-export`, `tenant-purge`, `tenant-restore` (needed for school data export on termination and erasure workflows; **est. 6–10 h, not separately itemised in the rev 2 hours — tracked in the Phase 7 re-baseline**). Test: export School A → purge → restore → content hash equals original, School B untouched.
- Every aggregation with `$lookup/$unionWith` must carry `schoolId` in every stage (review rule + test).
- Platform/login reads (memberships by user, platform dashboards) go through a separate `PlatformRepository` with restricted imports.
- Per-tenant rate limits/quotas (entitlements) to contain noisy neighbours.

**Risks & mitigations.** Residual developer error → harness + code review of repository/plugin changes as security-critical. Atlas/DB credential compromise exposes all tenants → least-privilege DB users, IP allow-list, field-level encryption for medical/bank data later.

**Revisit trigger.** A customer or regulator requiring physical isolation; a tenant large enough to dominate load; evidence of an isolation defect.

**Required tests.** Isolation suites 1–14 (doc 06 §6); schema classification test; deliberate-unscoped-query test; tenant export/purge/restore round-trip.

**Recommendation: Approve.**

---

## ADR-4 — Vitest, Supertest, Playwright, `mongodb-memory-server` (replica set)

**Decision.** Vitest for unit and API integration (with Supertest against the Express app factory), Playwright for browser E2E, `mongodb-memory-server` in **replica-set mode** so transactions behave like production. One database per test file; the isolation and concurrency suites run with controlled parallelism.

**Why.** TypeScript/ESM-native, fast, one runner across the monorepo; real transactions are essential for payments/imports/promotions; no cloud DB needed in CI (₹0).

**Alternatives.** Jest (more mature ecosystem, more TS configuration friction); Docker-based MongoDB for tests (closer to production but heavier on Windows 11 Home); testing against Atlas (couples CI to a free tier).

**Trade-offs.** `mongodb-memory-server` downloads `mongod` binaries on first use (network + disk) and its version must be **pinned to match the production MongoDB major version**; replica-set start-up adds seconds per run; in-memory ≠ real hardware performance (perf tests use a real `mongod` with realistic data).

**Implementation consequences.** Workspace-level Vitest config; global setup that starts one replica set and creates per-file databases; fake-timer utilities (for session expiry, job leases); test data factories using faker (synthetic only); coverage via v8 reported on security-critical code; CI caches the mongod binary; a separate Playwright project with mobile viewports (360×640, 390×844) and a second-origin page for CSRF tests.

**Risks & mitigations.** Flaky parallel DB tests → per-file DB names and no shared state; version drift → pinned versions logged at test start.

**Revisit trigger.** Persistent flakiness or tooling blockers on Windows/CI.

**Required tests.** The harness itself: a smoke test asserts transactions work (abort rolls back) and that two parallel files don't share data.

**Recommendation: Approve.**

---

## ADR-5 — MongoDB-backed job queue (design now, implement in R3)

**Decision.** A small queue in the existing database (`jobs` collection) behind a `JobQueue` interface, run by a worker process from the same codebase. Used from R3 for email/notifications, large exports, bulk PDFs and bulk imports. **R1 does not use it** (sync email, capped sync import).

**Why.** Zero extra infrastructure/cost (no Redis); transactional enqueue with business writes (the *outbox* pattern) is easy when jobs live in the same database; volume is tens of jobs per minute, not thousands per second.

**Alternatives.** BullMQ + Redis (excellent, but a paid/hosted Redis or another process to run); cloud queues (cost/vendor); `agenda`/similar libraries (adds a dependency with its own quirks and less control over fencing). The interface keeps a later swap local.

**Trade-offs.** Polling load on the database (mitigated with adaptive idle back-off; matters on free tiers with op limits — verify); less throughput and tooling than a dedicated queue; we own the correctness of leasing/retries, hence the tests below.

### Design details

**Document** (`jobs`): `type, payload, payloadVersion, schoolId?, status (queued|running|succeeded|failed|dead|cancelled), priority, runAt, attempts, maxAttempts, lockedBy (workerId), lockedUntil (lease), heartbeatAt, dedupeKey?, lastError, result?, createdAt/By, startedAt, finishedAt`.
Indexes: `{status, runAt, priority}` (claim path), `{lockedUntil}` (recovery), unique `{type, dedupeKey}` where `dedupeKey` exists.

**1. Atomic claiming.** A worker claims with a single `findOneAndUpdate` (MongoDB guarantees atomicity per document, so two workers can never receive the same job):

```
filter: { runAt <= $$NOW,
          $or: [ { status:'queued' },
                 { status:'running', lockedUntil < $$NOW } ] }     // second branch = stuck-job recovery
sort:   { priority: -1, runAt: 1 }
update (pipeline form): set status='running', lockedBy=workerId,
                        lockedUntil = $$NOW + leaseSeconds, startedAt, heartbeatAt;  attempts = attempts + 1
returnDocument: 'after'
```
Lease and `runAt` timestamps are computed with the **database clock** (`$$NOW` in an update pipeline; requires MongoDB ≥ 5.0 — verify the chosen tier) so skew between worker machines can't cause double-processing.

**2. Leases, heartbeat and fencing.** While a handler runs, the worker extends `lockedUntil` every lease/3 with `updateOne({_id, lockedBy: me, attempts: n, status:'running'}, …)`. If that matches 0 documents the lease was lost → the worker aborts the handler. **Completion and failure updates use the same `{_id, lockedBy, attempts}` fence**, so a stalled ("zombie") worker that wakes up after another worker re-claimed the job cannot overwrite the result.

**3. Retries.** Handler outcomes: success; **retryable** error → `status='queued'`, `runAt = now + min(cap, base·2^(attempts−1)) ± jitter`; **permanent** error (validation, missing tenant, unknown payload version) → `dead` immediately. After `maxAttempts` → `dead` (dead-letter). Dead jobs appear on the platform health page and in alerts; manual requeue is a permission-guarded, audited action.

**4. Stuck-job recovery.** Crash/kill/deploy mid-job → lease expires → the next claim picks it up (branch 2 above) and increments `attempts`. A periodic **reaper** marks `running` jobs whose lease expired **and** `attempts >= maxAttempts` as `dead`, so a poison job that kills workers can't loop forever. Graceful shutdown (SIGTERM): stop claiming, finish or release the current job (`status='queued'`, lease cleared).

**5. Idempotency and duplicate prevention (two layers).**
- *Enqueue-level:* optional `dedupeKey` with a **unique index `(type, dedupeKey)`**; enqueue is an upsert/insert where a duplicate-key error is treated as "already enqueued". Keys encode the business event (e.g. `receipt-email:<paymentId>`); recurring jobs include a time bucket (`daily-dues:<schoolId>:2027-03-14`). Jobs created from a business write are inserted **inside the same transaction** (outbox) so a job exists if and only if the change committed.
- *Handler-level:* delivery is **at-least-once**, so every handler must be idempotent: check-then-act against durable state, and write results under unique keys (notification rows have unique `(schoolId, dedupeKey, channel, recipient)`; import commit is a state machine on `import_batches`; PDF output uses a deterministic file key). At-least-once + idempotent handlers = effectively once.

**6. Concurrency control.** Several worker processes/threads are safe by construction (atomic claim). Per-type concurrency limits (e.g. 2 PDF jobs at once for memory), batch size caps; polling interval adaptive (e.g. 1 s when busy, up to 10 s when idle with jitter) to keep database operations low.

**7. Tenancy.** `payload.schoolId` mandatory for tenant jobs; the worker enters `TenantContext` from it; missing/unknown school → permanent failure; handlers use the same tenant repositories.

**Implementation consequences.** `jobs` model + registry of typed handlers (Zod payload schemas, versioned); worker entrypoint (`worker.ts`); platform health view (queue depth, oldest queued age, dead jobs); metrics/logs include `jobId` and `attempt`.

**Risks & mitigations.** Lost updates from clock skew → DB-side time. Long handlers exceeding lease → heartbeat. Queue growth after outage → priority, per-type limits, alerts on age. Database as bottleneck → the interface permits a later swap to BullMQ/another broker.

**Revisit trigger.** Sustained queue latency, > ~10 jobs/second, or the polling load becoming a cost/limit problem.

**Required concurrency & failure tests (all in CI, fake clock where needed).**
1. **Exactly-once claim:** 200 jobs, 20 concurrent workers → every job processed exactly once (assert per-job counter == 1).
2. **Crash recovery:** kill a worker mid-job → job reclaimed after lease expiry and completed; `attempts` incremented.
3. **Zombie fencing:** worker A stalls beyond lease, B reclaims and completes, A then tries to complete/fail → rejected, final state from B, **side effect happened once**.
4. **Heartbeat:** a handler longer than the lease keeps its lock; a handler that stops heart-beating loses it.
5. **Retry schedule:** deterministic back-off with jitter bounds; retryable vs permanent classification; `dead` after `maxAttempts`; manual requeue audited.
6. **Poison-job reaper:** job that always crashes the worker ends `dead`, not infinite.
7. **Duplicate prevention:** 50 parallel enqueues with the same `dedupeKey` → one job; transactional outbox rolls back with the business write (no orphan job, no missing job).
8. **Handler idempotency:** run each handler twice (and once after simulated crash-after-effect) → single external effect (adapter mock call count = 1; unique notification row).
9. **Tenancy:** job without/with unknown `schoolId` → permanent failure, no writes; job for School A cannot touch School B.
10. **Graceful shutdown:** SIGTERM mid-job → job released or completed, never lost or duplicated.
11. **Priority/limits:** per-type concurrency cap respected; idle polling back-off observable.

**Recommendation: Approve the design now (so Phases 1–7 only define the interface and `jobs` schema); re-confirm at the start of R3.**

---

## ADR-6 — pdfmake for generated PDFs (receipts, report cards, certificates)

**Decision (conditional).** Use **pdfmake** (declarative document definitions, pure JavaScript) running in the API/worker process, with bundled **Noto Sans + Noto Sans Devanagari** fonts (SIL OFL licence — verify before bundling).

**Why.** No headless browser (Chromium needs hundreds of MB of RAM and is awkward on a small VPS); deterministic output; small dependency footprint; layouts for receipts and report cards are structured tables that suit it.

**Alternatives.** Headless Chromium (Puppeteer/Playwright) — best HTML/CSS fidelity and complex-script rendering, but heavy and fragile on small hosts; `@react-pdf/renderer` (React components, similar font/shaping caveats); `pdf-lib`/`pdfkit` (lower level — more code).

**Trade-offs.** Layout is code-defined rather than HTML/CSS; school-specific templates are limited to configurable blocks (logo, colours, header/footer text, field selection) — acceptable for v1; **complex-script shaping (Devanagari conjuncts/matras) must be proven**, not assumed (risk R20).

**Implementation consequences.** **Spike-gate at the start of R2 (budget 4–6 h):** render a bilingual receipt (English + Hindi names/amount-in-words), check shaping, file size, generation time/memory for a 60-page batch; if the spike fails, fall back to Chromium *for report cards only* run as a worker job, or re-scope Hindi PDF output. Templates live in code; school-specific values come from validated data only (escaped, no user-supplied HTML). PDFs generated on demand or via the job queue for batches (R4) and streamed, not buffered whole.

**Risks & mitigations.** Indic rendering defects → spike + visual regression of sample PDFs; font licence/size → verify, subset fonts; memory spikes on batch generation → queue with concurrency cap.

**Revisit trigger.** Spike failure; school demands pixel-faithful custom templates.

**Required tests.** Snapshot tests of PDF text content (extract and compare) and a few rendered-image visual checks; Unicode names (Devanagari, long names) test; receipt number/amount correctness; access control on download (tenant + permission).

**Recommendation: Approve conditionally (spike must pass at R2 start).**

---

## ADR-7 — Authentication and tenancy implementation order (inside Phase 3)

**Decision.** Build **tenancy primitives first, then identity, then membership binding, then authorization**, with no data-bearing route written before the tenant-safe repository exists:

| Step | Content | Exit check |
|---|---|---|
| **3a Tenancy primitives** | `TenantContext` (AsyncLocalStorage), `TenantRepository`, Mongoose tenant plugin, `PlatformRepository` (restricted), collection registry, ESLint rules, schema-classification test, deliberate-unscoped-query test — all tested with an **injected** context (no auth yet) | Unscoped query throws; models classified |
| **3b Identity** | `users` (flexible identifiers — see D-03 handling), Argon2id hashing, sessions, login/logout/logout-all, lockout/throttling, CSRF, cookie flags, sync email adapter (reset/invite), password reset | Auth tests; Playwright login/session persistence/CSRF |
| **3c Membership binding** | `schools`, `memberships`, session → `activeMembershipId` → `TenantContext`, switch-school, `X-Active-Membership` assertion, platform-vs-school separation | Tenant-switching Playwright + 409 stale-tab test |
| **3d Authorization** | roles/permissions as data, `PermissionService`, route manifest (`{permission, tenancy, entitlement}`), deny-by-default middleware, record-scope helpers, entitlement-lite | Manifest test; permission matrix tests |
| **3e Audit + isolation harness v1** | `AuditService`, audit-on-write test driven by manifest, universal route sweep (suites 1–14 for existing routes) | Harness green; Phase 3 report |

**Why this order.** Identity is global but memberships are tenant-owned, so the two concepts interlock; building authentication first would create a period where code queries the database before any tenant-safe access layer exists, forcing a retrofit — the classic way tenant-leaks are introduced. Tenancy-first costs nothing visible (a login screen appears only at 3b) and means *every* later query is safe by default.

**Alternatives.** Auth first, then tenancy (earlier demo, higher retrofit/leak risk — rejected); one big-bang Phase 3 without internal checkpoints (harder to review/test — rejected). Approval is still requested once at the end of Phase 3, but 3a–3e produce separate reports inside it so you can stop early if something looks wrong.

**Trade-offs.** Longer before anything is demoable; some tenancy code is exercised through test fixtures before real login exists.

**Risks & mitigations.** Over-designing 3a before seeing real queries → keep the repository API minimal and extend with the first real module (Phase 4); review the plugin/repository as security-critical on every change.

**Revisit trigger.** If 3a overruns its estimate by > 1.5× (the re-baseline #2 rule), stop and review.

**Recommendation: Approve.**

---

## Approval checklist for D-23 (reply per ADR)

| ADR | Your decision (Approve / Change / Reject) | Notes |
|---|---|---|
| 1 Server-side sessions | | |
| 2 Next.js → Express same-origin routing | | |
| 3 Shared MongoDB + `schoolId` | | |
| 4 Vitest + memory-server replica set | | |
| 5 MongoDB job queue (design now, build R3) | | |
| 6 pdfmake (conditional on R2 spike) | | |
| 7 Auth/tenancy implementation order | | |
