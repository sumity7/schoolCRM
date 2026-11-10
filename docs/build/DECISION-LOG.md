# Decision Log (build phase)

Authority order when documents conflict: (1) security/privacy/tenant isolation → (2) latest accepted decisions in `docs/phase-0/14` → (3) ADRs in `docs/phase-0/16` → (4) `docs/phase-0/15` MVP scope → (5) other Phase 0 docs → (6) engineering defaults recorded here.

## Standing decisions (from the build directive, 2026-11-09)

| ID | Decision | Status |
|---|---|---|
| D-01 | Generic CBSE-style, configurable, **no hard-coded CBSE assumptions** | Accepted (provisional; validate with pilot school before each module is finalised) |
| D-03 | Identity supports email **or** phone; parent login details finalised before R3 | Deferred to R3; model flexible (built) |
| D-04 / D-29 | 5–10 h/week; plan on 7.5 | Accepted |
| D-19 | ₹0/month; no real data before the Production-Readiness Gate | Accepted |
| D-23 ADR-1 | Server-side sessions + explicit CSRF | **Approved** |
| D-23 ADR-2 | Same-origin Next.js → Express routing | **Approved** |
| D-23 ADR-3 | Shared MongoDB + strict `schoolId`; school export/purge/restore scripts | **Approved** |
| D-23 ADR-4 | Vitest + in-memory replica set | **Approved** |
| D-23 ADR-5 | MongoDB job queue design (re-evaluate before R3) | **Approved (design)** |
| D-23 ADR-6 | pdfmake, conditional on Hindi rendering spike at start of R2 | **Approved (conditional)** |
| D-23 ADR-7 | Tenancy primitives → identity → membership → authorization → audit | **Approved** (followed: Phase 3a–3e) |
| D-27 | Attendance before fees | Accepted |
| D-26 | Pilot-school funding proposed, **not confirmed** | Deferred |
| D-28 | **No spending authorised** (domain, hosting, legal review, paid APIs/services) | Standing restriction |
| D-12 | No legal/regulatory compliance claims without qualified review | Standing restriction |

## Engineering decisions made during the build

| # | Decision | Rationale |
|---|---|---|
| E-01 | Memberships store `roleKeys: string[]` (not `roleIds`) and roles are unique per `(schoolId, key)` | System role keys are stable identifiers; avoids id lookups and keeps invites/seeds simple. Deviation from doc 05 `roleIds`, documented here. |
| E-02 | `AuditLog`, `User`, `Session`, `AuthToken`, `School` are *platform* models; `Membership`, `Role`, `Counter`, `IdempotencyKey` are *tenant* models | Users are global; audit has optional `schoolId` and is read only through `AuditService` (school reads always scoped to the tenant). |
| E-03 | Tenant context lives in `AsyncLocalStorage`, set by session middleware; cross-tenant access only through `PlatformRepository`/`runAsPlatform(reason)` | Fail-closed enforcement; lint-restricted importers. |
| E-04 | CSRF: JSON-only + `X-Requested-With: edunex` + `Origin`/`Sec-Fetch-Site` check, applied in the route registrar for all mutating routes (login included) | ADR-1. Webhooks may be exempt only with a stated reason (none yet). |
| E-05 | `X-Active-Membership` header is a consistency *assertion* (409 `TENANT_CONTEXT_CHANGED` on mismatch), never an authority | Stale-tab protection (E2E-03) without trusting client tenant data. |
| E-06 | Dev email adapter (`DevEmailAdapter`) writes to memory/`.data/mail`, status `sent_dev`; never claims delivery; bodies (with one-time links) are not logged | D-28 (no paid provider); honesty rule. |
| E-07 | R1 provisioning is by CLI (`npm run cli`) — no web Super-Admin login in R1 | doc 15 §1B. |
| E-08 | Passwords: Argon2id (`argon2`), test params reduced only when `NODE_ENV=test` | ADR / doc 04. |
| E-09 | Default session idle timeout 480 min, absolute 14 days (30 with "keep me signed in") — configurable env | Teachers use phones during a school day; values are policy not architecture. |
| E-10 | Login failures return one generic 401 for unknown / bad password / locked / disabled | No user enumeration. |
| E-11 | Suspended/deactivated schools block staff access (no read-only mode yet) | Policy D-10 (grace/read-only/export) still open; safest default now. Known limitation. |
| E-12 | Rate limiting uses in-memory store (single process) | Adequate for one-VPS pilot; documented in KNOWN-LIMITATIONS; swap store when scaling out. |
| E-13 | Services may import OTHER modules' repositories (read/validate refs), never their models or routes; cross-tenant access stays restricted to auth/users/schools/platform | Pragmatic reading of doc 09 §2 for a modular monolith; lint still forbids model imports and PlatformRepository outside the allow-list. |
| E-14 | Attendance = one document per student per day, saved with a single transactional `bulkWrite` upsert; unique `(schoolId, studentId, date)` | doc 04 §11. All-or-nothing save is tested. |
| E-15 | Teacher edit window (`attendancePolicy.teacherEditWindowDays`, default 0 = same day): older dates are locked for `assigned`-scope users (409) and changed via a correction request approved by someone else; `school`-scope users may edit with a full audit diff | D-21 default; configurable per school. |
| E-16 | Attendance percentage = present-equivalent units / (marked days − excused days); late counts per policy, half-day weight per policy | Shared pure function `summariseAttendance` (unit-tested). Policy values are per-school data (D-01). |
| E-17 | Students list for `own` scope (parent/student) is refused on `/students`; parents use portal endpoints in R3 | Keeps parent access strictly through verified guardian links. |
| E-18 | Mongoose `undefined` is dropped from `$set`; repositories must write explicit `null` to clear fields | Found by tests (re-admission bug). |
| E-19 | Student import (R1): CSV only, synchronous, ≤ 2,000 rows; column auto-mapping by exact header synonyms; dates parsed in a school-chosen order (DMY default, 4-digit years only); commit valid rows / report rejected rows (D-24) in 100-row transactions with per-row fallback; `Idempotency-Key` required; rollback deletes only batch records nobody touched since | doc 15 §R1, D-24. No XLSX parser adopted (SheetJS advisory history, doc 04). |
| E-20 | Student CSV export uses the import labels as headers (re-importable) and neutralises formula injection on every cell; UTF-8 BOM for Excel | Threat T16. |
| E-21 | Backups: Node-based encrypted logical backup (`.edxbak` = AES-256-GCM over gzip'd canonical Extended-JSON lines, scrypt key from `BACKUP_PASSPHRASE`) instead of `mongodump` as the primary tool | `mongodump` is not installed in this environment and cannot be exercised in tests; the EJSON format is open and type-exact; restores verify per-collection SHA-256 digests. `mongodump` remains acceptable on the server as an additional copy (doc 12 §9.2). |
| E-22 | Per-school export/purge/restore are CLI-only operator tools; exports never contain credentials (restored users reset passwords); purge requires a deactivated school, the code typed twice and a readable export of that school | doc 12 §7, §9.7; irreversible actions guarded. Owner self-service export (D-10) not built. |
| E-23 | Whole-school attendance reports aggregate in MongoDB; covering index `{schoolId, sessionId, date, studentId, status}` on attendance | Perf run: 4.8 s → 0.48 s p95 on 333k records; one extra index on a low-write collection. |
| E-24 | API binds `127.0.0.1` by default; internal targets use `127.0.0.1` not `localhost`; production requires https origins and `TRUST_PROXY_HOPS ≥ 1` | ADR-2 (only the proxy reaches the API); IPv6 `localhost` resolution pitfall found in testing. |
| E-25 | Production CSP: same-origin only, `'unsafe-inline'` scripts until nonce support | Next bootstrap scripts; verified with no violations in a real browser. |
| E-26 | zod 3 and Next 15 advisories accepted temporarily with documented mitigations; major upgrades scheduled (zod 4 before R3) | Breaking upgrades are their own tested change, not a side effect of R1 hardening. |
