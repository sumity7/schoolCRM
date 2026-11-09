# K. Testing & Acceptance Criteria

## 1. Principles
1. **Nothing is "done" until its tests ran and passed** — phase reports include the actual command and output summary.
2. Tests are written with the feature, not after. Each test title contains its requirement id (`REQ-FEE-014 …`) for traceability.
3. Synthetic data only (faker). Real student data never enters dev/staging/CI.
4. Security and tenant tests are first-class, not an add-on.

## 2. Test layers & tooling

| Layer | Tool | What it proves | Runs |
|---|---|---|---|
| Static | `tsc --noEmit` (strict), ESLint (incl. tenancy rules), Prettier, `gitleaks`, `npm audit` | types, forbidden patterns, secrets, vulnerable deps | every PR |
| Unit | Vitest | pure logic: money, grading, rounding, late fees, allocation, date/working-day math, permission resolution | every PR |
| API integration | Vitest + Supertest + mongodb-memory-server (**replica set** → real transactions) | routes, middleware chain, validation, authz, DB constraints | every PR |
| Isolation harness | same | doc 06 §6 suites 1–14 | every PR (blocking) |
| Concurrency | Vitest, `Promise.all` parallel requests | duplicate payment, double attendance, receipt number collisions, double library issue | every PR (finance/attendance) |
| E2E | Playwright (desktop + 360 px mobile viewports; Chromium first, WebKit/Firefox nightly) | real user flows through UI+API | per phase + nightly |
| Accessibility | `@axe-core/playwright` in E2E | automated WCAG checks (not a full audit) | nightly |
| Performance | autocannon or k6 on seeded dataset | p95 latency, index use (`explain` no COLLSCAN) | phase 10 + before release |
| Restore drill | scripted: backup → restore to scratch DB → run `verify-ledger` & counts | backups actually work | before go-live, then quarterly |

### 2.1 Mandatory critical-flow E2E (Playwright) — API tests do **not** replace these

Run in CI against the production-style topology (same-origin proxy, doc 16 ADR-2) with Chromium desktop, Chromium mobile emulation (360×640, 390×844) and — nightly — WebKit (iOS-Safari-like).

| ID | Flow | Must prove |
|---|---|---|
| E2E-01 | **Login & session persistence** | login → reload / new tab stays authenticated; idle and absolute timeout expire the session; logout invalidates it (back button, other tab); session revoked elsewhere → next navigation returns to login; password reset revokes sessions; cookie has `HttpOnly`, `Secure` (prod topology), `SameSite=Lax`; no token visible to page JS |
| E2E-02 | **CSRF** | a page on a **second origin** that forges a state-changing request with the victim's browser cookies is rejected (403) and changes nothing; missing custom header and wrong `Origin` rejected; form-encoded bodies rejected; GET never mutates |
| E2E-03 | **Tenant switching** | user with memberships in School A and B sees only A's data; after switching, only B's (including back/forward, cached pages, search); **stale-tab test:** tab 1 left on A while tab 2 switches to B → tab 1's next action returns `409 TENANT_CONTEXT_CHANGED` and does not write to B |
| E2E-04 | **Attendance submission** | teacher opens an assigned section, marks, submits; reload shows saved values; double-click/double-submit creates no duplicates; save is all-or-nothing (simulated network drop mid-save leaves no partial silent save, UI shows retry); unassigned section blocked via UI **and** by URL manipulation; non-working-day message; edit after window requires the approved path |
| E2E-05 | **Mobile workflows** | login, student search/view, attendance marking and submission usable at 360 px: no horizontal scroll, tap targets ≥ 44 px, on-screen keyboard doesn't hide the submit control, works with touch events |

These five are part of the Phase 3 and Phase 6 exit gates (doc 10) and are included in the doc 15 §7 hour estimates. Later releases add their own critical flows (e.g. R2 fee collection).

Coverage target: no blanket %; instead **100 % of routes in the manifest have isolation + permission tests**, and ≥ 90 % branch coverage on money/grading/auth/tenancy code (measured, reported).

## 3. The ten mandatory acceptance scenarios (from spec §42), made concrete

| # | Scenario | Given / When / Then |
|---|---|---|
| 1 | School A cannot access School B's students | Seed A,B; A-admin token; `GET /students/:Bid` → 404; `GET /students` → only A; `PATCH/DELETE` B id → 404, B unchanged |
| 2 | Parent A cannot access another parent's child | Parent A linked to child 1; `GET /parent/children/:child2` → 404; link `endedAt` set → child 1 also 404 immediately |
| 3 | Teacher cannot modify unauthorised class | Teacher assigned Sec 5A; `PUT /attendance/sections/5B` → 403; `PUT /exams/:id/marks` for unassigned subject → 403; DB unchanged |
| 4 | Accountant cannot change marks | Accountant token `PUT /exams/:id/marks` → 403 |
| 5 | Duplicate payment webhook creates no duplicate | Same `eventId` twice (and concurrently ×10) → exactly 1 payment, 1 receipt; 2nd+ return 200 no-op; tampered signature → 400 & logged |
| 6 | Receipt numbers never collide | 50 parallel `POST /payments` (distinct keys) → 50 unique sequential receipt nos in school; same key ×50 → 1 payment; A and B each start own series |
| 7 | Promotion preserves history | Promote 5A→6A; old enrollment unchanged (class/section/status closed); marks/invoices/attendance of old session still retrievable and unchanged |
| 8 | Subscription expiry doesn't erase records | Expire → grace → suspended: row counts identical; read/export allowed per policy; write blocked per policy; reactivation restores |
| 9 | Unauthorised exports blocked | Teacher `GET /students/export` → 403; user w/o `reports:export` → 403; export rate limit → 429; B's data never in A's export |
| 10 | File URLs don't bypass tenant authz | A requests B's `fileId` → 404; replay signed URL after TTL → denied; modified key → denied; guardian requests other child's document → 404 |

## 4. Acceptance criteria by MVP module (Given/When/Then highlights)

### AUTH
- Wrong password ×5 → lockout; response identical to unknown-email response; correct password after lock expiry works.
- Reset token single-use; second use fails; all sessions revoked after reset.
- Logout makes the old cookie useless (next call 401). Deactivated membership → 401/403 on next request.
- Cookies: `HttpOnly; Secure (prod); SameSite=Lax`; no token in any response body or URL; logs contain no credential strings (test greps captured logs).

### RBAC
- Every route in manifest: with each role, allowed/denied exactly per matrix (generated table test from doc 03 data).
- Role-grant subset rule; last owner cannot be removed; permission removal effective on next request.

### Students / Guardians / Import
- Duplicate `admissionNo` in same school → 409; same number in another school OK.
- Student limit from plan reached → create returns `ENTITLEMENT_REQUIRED`; existing data still readable.
- Import: 1,000-row file with 30 bad rows → 970 committed (or all/none per chosen mode D-24), 30 in error report with row number + reason; none silently dropped; re-import same file → duplicates reported not created; rollback removes only untouched batch rows.
- Export: cell `=1+1` in name exported as `'=1+1`.

### Attendance
- Duplicate PUT same class/date → updates, never duplicates (unique index asserted by direct insert attempt).
- Marking on Sunday/holiday → 422 unless override permission; future date → 422; student not enrolled that date → 422.
- Correction workflow: teacher requests, class teacher/principal approves, audit shows before/after.
- Monthly percentage = present+late(configurable)+half(0.5) / working days counted from enrolment date (unit tests with table of cases).

### Fees & ledger (highest rigour)
- Money math: property-based tests (fast-check) — allocations always sum to payment; no negative balances; rounding of percentage concessions defined & tested.
- `Σ ledger entries per invoice == invoice.balance` after any random sequence of charge/payment/reversal/refund operations (property test) and after concurrent operations.
- Reversal: payment `reversed`, receipt `cancelled`, ledger has reversing entries; original rows unchanged (compared byte-wise); approver ≠ requester when policy on.
- Overpay without advance flag → 422; advance creates `unallocatedPaise` credit applied to later invoice.
- Invoice generation re-run → 0 new invoices (unique key) and idempotent response.
- Closed day: payment with `paidOn` = closed date → 409 unless reopened.
- Discount above role limit → pending approval; cannot be self-approved.
- Gateway (mock, then Razorpay test mode): amount mismatch between order and webhook → flagged, not applied; browser "success" without webhook → unpaid.
- Receipt PDF: contains school name, receipt no., amount in words (if the school wants it — D-06), unique no.; accessible only to owner tenant & permitted roles.

### Exams & results
- Grade boundary tests at each edge (49.99/50.00); rounding mode per scale; missing marks ⇒ `incomplete` not zero; absent ⇒ policy (fail/exempt); exempt excluded from totals; optional subjects excluded from non-takers; failed-subject rules; rank ties.
- Published result immutable (update route 409); correction creates v2 with reason, v1 still retrievable.
- Same inputs ⇒ same outputs (determinism test); grading scale change after publish doesn't alter old results (snapshot).

### Notices / Notifications
- Targeted notice reaches exactly target audience (class 5A guardians) and nobody else; sibling guardians receive one message; no consent ⇒ no SMS/WhatsApp (and for email depending on policy).
- Email adapter failure → status `failed` after retries, never `delivered`; with the dev adapter statuses read `sent (dev)`, never fabricated "delivered".

### Subscription / entitlements
- Feature-off module → 403 `ENTITLEMENT_REQUIRED`; limits enforced; trial/grace transitions by clock-controlled tests; data never deleted by status change.

### Files
- Disallowed MIME (exe, html, svg) rejected even with renamed extension (magic-byte test); size cap; path traversal names neutralised; `nosniff` header present.

### Audit
- Every ✎ endpoint writes an audit row (route-manifest-driven test); audit API has no update/delete; PII redaction list honoured.

## 5. Non-functional acceptance (pilot)
| Area | Target (proposed) |
|---|---|
| Latency | p95 < 500 ms for common reads on realistic data; < 1.5 s for class attendance save (60 students) |
| Dataset | 1 school × 1,500 students × 220 days attendance + 1 year invoices/payments; also 20-school synthetic tenant load |
| Availability | measured only (no SLA promise without paid infra) |
| Mobile | all teacher & parent flows usable at 360 px, no horizontal scroll, tap targets ≥ 44 px |
| Browsers | latest Chrome/Edge/Safari-iOS/Chrome-Android |
| Accessibility | axe: 0 critical/serious on core screens; keyboard-only completion of login, attendance, fee collection |
| Security | `npm audit` no high/critical unresolved; OWASP ZAP baseline scan on staging; manual pen-test checklist from threat model |
| Backup | restore drill completed with documented RTO/RPO measured |

## 6. Phase exit checklist (applied each phase)
☐ Acceptance criteria for the phase pass ☐ new routes registered in manifest ☐ isolation & permission tests added & green ☐ no regression in prior suites ☐ lint/type/audit clean ☐ docs updated (API/data dictionary/permission matrix) ☐ env example updated ☐ known issues listed honestly ☐ phase report delivered → **your approval**.
