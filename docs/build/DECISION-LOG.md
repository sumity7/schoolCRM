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
