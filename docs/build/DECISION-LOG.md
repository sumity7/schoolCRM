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
| E-27 | **ADR-6 confirmed**: pdfmake 0.3.12 + vendored Noto Sans / Noto Sans Devanagari (SIL OFL). Spike 2026-11-10: i-matra reordering, conjuncts, reph, nukta, candrabindu and ₹ render correctly; Latin needs its own face, so text is split into script runs | Caveat: copy/paste text extraction of Devanagari from the PDF is scrambled (visual output correct). |
| E-28 | Fee defaults for open decisions (per school, editable at `PATCH /fees/policy`): **D-06** one receipt series per financial year (Apr–Mar), prefix = school code, `PREFIX/2026-27/000001`; invoices `INV/<FY>/n`. **D-07** concessions ≤ 5 % or ≤ ₹500 auto-approved for `discounts:apply`; above → pending, approved by `discounts:approve` (Owner) and never by the requester. **D-08** no automatic late fee; manual late fee with reason. **D-09** refunds only from advance credit; payment reversals and refunds need a second person (`refunds:approve`); voids/adjustments Owner-only | doc 14 proposed defaults; directive: sensible defaults without routine approvals. |
| E-29 | Receipt = the payment record (unique `receiptNo`, immutable `receiptLines` snapshot); a reversed payment prints as CANCELLED. No separate `receipts` collection | Simpler than doc 05 with the same guarantees (unique number allocated inside the payment transaction). |
| E-30 | Invoice uniqueness via `billingKey = structure family + instalment` (cleared on void so a voided instalment can be re-billed); structures are versioned, published versions immutable | doc 05 §6 "re-running generation can't double-bill". |
| E-31 | **ADR-5 re-evaluated at R3 start: keep the MongoDB job queue** (lease 60 s, exponential backoff, dead-letter after maxAttempts, per-school de-dup key, handlers run in the job's school context, at-least-once ⇒ handlers idempotent). In-process worker in the API (`JOBS_ENABLED`) | No Redis at zero budget; volume is tiny (notice e-mails). Interface small enough to swap for BullMQ later. |
| E-32 | **D-03 default: parents log in with e-mail + password** via a single-use invitation, allowed only for a guardian link that is verified AND portal-enabled. One login per guardian per school covers all siblings. Access to a child is re-checked on every request (verified, portal on, not ended) | Phone/OTP login needs SMS (D-28: no paid services). Student logins (D-16) not built. |
| E-33 | **Own-scope grants are denied by default on every route**; only an explicit allow-list (parent portal, notices, own staff profile) serves them — enforced in the route registrar and pinned by a manifest test | Found while testing R3: a parent reached a staff report (empty result, but still the wrong door). |
| E-34 | Notices: audiences everyone / staff / parents / selected sections; teachers post only to sections they teach; e-mail goes only to guardians with a VERIFIED link, deduplicated by address, at most once per (notice, address) | doc 02 NOT; consent policy (D-12/D-18) undecided → conservative. |
| E-35 | **D-15 default grading**: configurable versioned grade bands (CBSE-like default A1…E), percentage half-up to 2 decimals, subject pass at pass marks, overall pass needs all counted subjects, absent = fail by exam setting (else excluded), exempt excluded, missing mark ⇒ incomplete (never 0), competition ranking (1,2,2,4) per section; published results immutable, corrections = new version with reason, result keeps a snapshot of its grading bands | doc 05/11; schools change bands per scale version. |
