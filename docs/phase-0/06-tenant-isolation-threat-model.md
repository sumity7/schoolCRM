# F. Tenant Isolation Architecture & Threat Model

## 1. The goal in one sentence

*A request authenticated as School A must be physically unable to read, write, list, count, export, download, search or infer the existence of any School B record — even if a developer forgets a filter.*

> *Beginner note:* "Defence in depth" = several independent locks. If one lock is forgotten or buggy, another still holds.

## 2. Isolation model: shared DB, shared collections, `schoolId` everywhere

Alternatives and why not (yet):

| Model | Isolation | Cost/ops | Verdict |
|---|---|---|---|
| **Shared collections + `schoolId`** | Logical (enforced in code + tests) | Lowest; easy migrations & analytics | **Chosen for v1** |
| Collection per tenant | Logical+ | Index/collection explosion, awkward migrations | No |
| Database per tenant | Strong | Connection & cost multiplication; painful on small Atlas tiers | Possible later as "dedicated deployment" for a large customer |

The risk of the chosen model is *developer error*, so the controls below target exactly that.

## 3. The seven locks

**Lock 1 — Tenant context comes from the server session only.**
`TenantContext{schoolId, membershipId, roleKeys}` is loaded from `sessions → memberships` in DB on every request and stored in `AsyncLocalStorage`. School-scoped routes have **no** `:schoolId` param; body/query/header `schoolId` is rejected by Zod `.strict()` and by a lint rule. Switching school = explicit `POST /auth/switch-school` that re-verifies membership and rewrites the session.

**Lock 2 — One repository base class is the only door to the database.**
`TenantRepository<T>` exposes `find, findById, create, update, softDelete, aggregate, bulkWrite…`; each automatically adds `{schoolId: ctx.schoolId}` (for `aggregate`, a leading `$match`; for `bulkWrite`/`insertMany`, stamps/validates each op). If no tenant context exists → throws `TenantContextMissingError` (fail closed). The few legitimate cross-tenant operations (login membership lookup, platform dashboard) use a separately named `PlatformRepository` that is only importable from `modules/platform` and `modules/auth`, audited.

**Lock 3 — Mongoose global plugin as a safety net.**
A schema plugin applied to every model flagged tenant-owned adds pre-hooks on `find*/update*/delete*/count*/aggregate` that **throw** if the query lacks `schoolId` equal to the context's. Catches code that accidentally uses a model directly. (`insertMany`/`bulkWrite` bypass some hooks → covered by Lock 2 and Lock 4.)

**Lock 4 — Static enforcement (lint + tests at build time).**
- ESLint: `no-restricted-imports` forbids importing `*.model.ts` outside `*.repository.ts`; forbids `req.body.schoolId`, `req.params.schoolId`.
- Schema test: iterates every registered Mongoose model; fails if a model is neither in `TENANT_MODELS` (has required `schoolId`, first index key `schoolId`) nor in the explicit `PLATFORM_MODELS` allow-list. A new collection can't be added without a conscious classification.
- Route-manifest test: every route must declare `{permission | public, tenancy: 'school'|'platform'|'none', entitlement?}`; undeclared = CI failure.

**Lock 5 — Cross-reference validation.**
Whenever a request carries an id of another entity (`classId` on a student, `invoiceId` on a payment), the service loads it **through the tenant repository** (so a foreign id simply isn't found) before use. Helper `assertSameTenantRefs(entity, {studentId: Students, …})`. Prevents "attach School B's section to School A's student".

**Lock 6 — Files and exports keyed by tenant.**
Storage keys `schools/{schoolId}/…`; no public bucket; download only through `/files/:id` which resolves the `files` doc via tenant repo then checks the *owner entity* permission; signed URL TTL ≤ 5 min, bound to key. Exports are generated inside a request/job that carries tenant context; the resulting file is a `files` doc owned by the school; download link requires auth + `reports:export`.

**Lock 7 — Adversarial tests in CI (the proof).**
See §6. Isolation is "done" only when these pass.

Additional rules:
- Cross-tenant → **404** (not 403) to prevent existence probing. Same timing path (no early-exit differences) is best-effort.
- Uniqueness always scoped by tenant; errors never reveal "this admission number exists in another school".
- Search, autocomplete, counts, pagination totals, and aggregate dashboards are all tenant-scoped (counts leak too).
- Caches (if any) keyed `schoolId:…`. No cross-tenant caching of API responses at CDN (`Cache-Control: private, no-store` on authenticated JSON).
- Background jobs carry `schoolId` in payload and re-enter tenant context; a job without it fails.
- Logs include `schoolId` for forensic filtering.

## 4. Super Admin / support access (the legitimate exception)

- Default: platform staff see **aggregates and metadata only** (counts, plan, status, health) — no student rows.
- Break-glass: Super Admin creates a `support_grant` {school, reason, duration ≤ 4 h, read-only, optional school-owner consent}. Session gets `supportGrantId`; the tenant context is set to that school *read-only* (write methods blocked at middleware); **every** request is audited with grant id; the school owner can view these audit lines. Impersonation of a user's identity (acting *as* them) is **not** supported.
- MFA required for any platform role.

## 5. Threat model (STRIDE-style, tailored)

**Assets:** student/guardian PII (children), medical notes, fee ledger & receipts, marks, staff salary, credentials/sessions, payment-gateway secrets, school branding/IP, backups.
**Actors:** malicious/curious school user (teacher, parent), compromised account, other tenant's user, external attacker, malicious insider (vendor staff), careless developer/AI-generated bug, supply-chain package.
**Trust boundaries:** Browser↔Web; Web↔API; API↔DB; API↔Storage; API↔Gateway webhooks; CI/CD; backups.

| # | Threat | Example | Primary mitigations | Verified by |
|---|---|---|---|---|
| T1 | **BOLA/IDOR** cross-tenant | Change `/students/:id` to B's id | Locks 2,3,5; 404 | Isolation harness |
| T2 | BOLA within tenant | Parent A reads Parent B's child; teacher edits other class | Record-scope in service; guardian link check; teacher_assignments check | Permission/scope tests |
| T3 | Mass assignment | Body includes `schoolId`, `role`, `paidPaise` | Zod `.strict()`; DTO allow-lists; schemas exclude server fields | Validation tests |
| T4 | Broken function-level auth | Accountant calls marks API | Route-declared permission; deny by default | Route-manifest test + matrix tests |
| T5 | Privilege escalation | Admin grants self Owner; custom role w/ `platform:*` | Grant-subset rule; last-owner protection | RBAC tests |
| T6 | Auth attacks | Credential stuffing, brute force, user enumeration, reset-token theft | Argon2id, throttling+lockout, generic errors, single-use hashed tokens, MFA for platform | Auth tests |
| T7 | Session theft/fixation | XSS steals token | HttpOnly cookie, rotation on login, CSP, idle+absolute timeouts, revoke-all | Auth tests, header tests |
| T8 | CSRF | Malicious site posts to API | SameSite=Lax, Origin check, custom header | CSRF tests |
| T9 | **NoSQL injection** | `{"$ne":null}` in login/filter | Zod coercion to primitives; `express-mongo-sanitize`-style strip of `$`/`.` keys; no raw query from client; sort/filter allow-lists | Injection tests |
| T10 | XSS | Notice body / student name with `<script>` | React escaping; no `dangerouslySetInnerHTML` (or sanitised); CSP; sanitise rich text server-side; PDF text escaping | XSS tests |
| T11 | File upload abuse | Executable/SVG/zip bomb; path traversal; polyglot | MIME sniff, allow-list, size caps, random keys, nosniff, no inline serve of user HTML/SVG; AV scan (prod) | File tests |
| T12 | File URL bypass | Guess other school's file id/URL | Authz at `/files/:id`; short-lived signed URL; private bucket | File authz tests |
| T13 | **Payment tampering** | Replay/forge success callback; double-submit | Server-side verification via gateway API; HMAC webhook signature; unique `(provider,eventId)`; idempotency keys; amounts from DB not client | Duplicate payment/webhook tests |
| T14 | Ledger manipulation (insider) | Accountant edits/deletes payment to pocket cash | Immutable payments; reversal needs approval (separation of duties); audit; day closing; reconciliation alerts | Finance tests |
| T15 | Data exfiltration via export | Bulk CSV of all students | `:export` permission; rate-limit; audit with row counts; tenant-scoped; optional reason | Export tests |
| T16 | CSV/Excel formula injection | Student named `=HYPERLINK(...)` | Prefix-escape cells starting `= + - @ \t \r` on export | Export test |
| T17 | SSRF / open redirect | URL fields fetched by server; `?next=` | No server-side fetch of user URLs; redirect allow-list | Review |
| T18 | Insider (vendor) misuse | Support browses student data | Break-glass, read-only, audited, owner visibility | Support tests |
| T19 | Secrets leakage | `.env` committed; keys in logs/frontend | `.gitignore`, secret scanning (gitleaks) in CI, Zod env, log redaction, only `NEXT_PUBLIC_` safe values | CI checks |
| T20 | Supply-chain | Malicious npm package | Lockfile, `npm audit`, minimal deps, pin versions, Dependabot, no postinstall scripts from unknown | CI |
| T21 | DoS / abuse | Expensive report loops, huge uploads, bulk requests | Rate limits by class, pagination caps, `maxTimeMS`, body size, job offload | Perf tests |
| T22 | Denial by tenant | One school's load starves others | Per-tenant rate/quotas; job fair-scheduling (P2) | Load test |
| T23 | Backup exposure | Unencrypted dump leaks | Encrypt backups, restricted access, tested restore | DR drill |
| T24 | Information leakage via errors | Stack traces, Mongo errors | Central error handler; sanitised messages | Error tests |
| T25 | Subscription bypass | School uses disabled module via API | Entitlement middleware server-side | Entitlement tests |
| T26 | Repudiation | "I never changed that mark" | Audit log with actor/before/after | Audit tests |
| T27 | Child-safety/privacy breach | Divorced guardian sees child data; student sees others | Guardian link flags (`endedAt`, `portalAccess`), data minimisation, no student↔student visibility | Parent/student tests |

Mapped to **OWASP API Security Top 10 (2023)**: API1 BOLA→T1,T2; API2 broken auth→T6,T7; API3 BOPLA/mass assignment→T3; API4 resource consumption→T21; API5 BFLA→T4,T5; API6 sensitive business flows→T13,T14; API7 SSRF→T17; API8 misconfiguration→T19,T24; API9 inventory management→route-manifest; API10 unsafe consumption→gateway/email provider responses validated.

## 6. Mandatory automated negative tests (tenant isolation suite)

Setup: seed **School A** and **School B** with the same shapes (students, guardians, invoices, payments, receipts, files, exams) and users of every role in each. Then:

1. **Universal route sweep.** For every route in the manifest with `tenancy:'school'`: call with A's token using B's object ids → expect `404` (or `403` for permission) and **zero** side effects (DB snapshot unchanged for B).
2. **List leakage.** Every list/search/count endpoint with A's token returns only A's `schoolId` rows; total counts equal A's count.
3. **Payload schoolId.** Create/update with `schoolId: B` in body → rejected (400) or ignored; stored record has A.
4. **Cross-reference attack.** Create student with `sectionId` from B; invoice for B's student; payment allocated to B's invoice; marks for B's exam → all rejected.
5. **Receipt/document access.** A's token on B's receipt id and B's receipt PDF URL → 404; expired/signed URL tampering → 403/404.
6. **File URL bypass.** Directly request B's `storageKey` through any exposed path → denied.
7. **Guess other tenant's user id.** `GET /users/:Bid`, reset-password for B's user using A context → 404.
8. **Export attack.** A's token requesting export with B filters/ids → only A rows or 404; export file unreachable by B... and A cannot fetch B's export job.
9. **Wrong-membership token.** User with membership only in A hits routes after membership ended/suspended → 401/403 immediately.
10. **Multi-membership user.** User in A and B: session active in A cannot read B until switch; after switch, cannot read A.
11. **Platform separation.** School Owner token on `/platform/*` → 403; Support staff without grant on `/students` → 403/404; with grant → read-only, writes 403, audit rows exist.
12. **Background jobs.** Job with missing/foreign `schoolId` → fails, no writes.
13. **Guard regression.** A test that deliberately constructs an unscoped query through a model and asserts the plugin throws.
14. **Parent/teacher scope (intra-tenant).** Parent A → Parent B's child 404; teacher on unassigned section 403.

Rule: a module's PR cannot merge if its routes are absent from the manifest or its sweep fails. **Tenant isolation is not declared complete until suites 1–14 are green and results are attached to the phase report.**

## 7. Residual risks (honest)

- Logical isolation depends on code discipline; mitigated, not eliminated. Periodic manual review + the harness.
- Atlas-level credentials give access to all tenants; use least-privilege DB users, IP allow-list, and no shared admin credentials in the app.
- Aggregation pipelines with `$lookup`/`$unionWith` can cross collections — each stage must carry a `schoolId` match; lint/review rule + test.
- A vendor-side breach exposes all tenants; hence encryption at rest (provider), field-level encryption for medical/bank data (P1), minimised data, and an incident-response plan.
