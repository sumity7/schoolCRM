# Test Report (actual executed results only)

## How tests are run
```
cd apps/api
# optional: reuse a locally installed mongod instead of downloading ~590 MB (PowerShell shown)
$env:MONGOMS_SYSTEM_BINARY="C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe"; $env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK="false"
npx vitest run
```
Tests use one in-memory MongoDB **replica set** (real transactions) with one database per test file. Synthetic data only.
Environment of the runs below: Windows 11, Node 22.17.1, MongoDB server binary 8.3.4 (local), Vitest 3.2.7.

## Latest run — checkpoint 4 (2026-11-09, session 2)

| Suite | File | Tests | Result |
|---|---|---|---|
| Tenancy kernel (locks 2–4, transactions) | `src/core/tenancy/tenancy.test.ts` | 22 | **22 passed** |
| Kernel: sequences, idempotency, audit redaction, rate limit, env validation | `src/core/kernel.test.ts` | 12 | **12 passed** |
| Shared package: identifiers, calendar days, permission catalogue/roles | `src/shared.test.ts` | 8 | **8 passed** |
| Auth, sessions, CSRF, reset/invite, tenant switching, hygiene | `test/auth.test.ts` | 29 | **29 passed** |
| Route manifest, isolation harness v2 (all id-routes — now incl. the 6 import routes — attacked with School B ids + byte-for-byte snapshot; collection-route leak sweep incl. CSV bodies), RBAC/escalation, audit | `test/rbac-isolation.test.ts` | 18 | **18 passed** |
| R1 domain: academics, students, guardians, attendance (scope, dates, corrections, percentages, concurrency) | `test/r1-domain.test.ts` | 25 | **25 passed** |
| Lint canaries (the architecture rules actually fire) | `test/lint-rules.test.ts` | 4 | **4 passed** |
| Import/export: CSV parser + formula-injection sanitiser, date parsing, mapping; 1,000-row/30-bad acceptance, re-import duplicates, class/section/roll/capacity/plan-limit validation, sibling guardian reuse, idempotent commit, rollback of untouched rows only, transaction-join proof, RBAC; student + attendance CSV exports (audited, re-importable) | `test/imports.test.ts` | 17 | **17 passed** |
| **Total** | 8 files | **135** | **135 passed, 0 failed, 0 skipped** |

Static checks at the same commit: `tsc --noEmit` (strict) clean; `eslint apps packages --max-warnings 0` clean.

## Browser E2E (Playwright) — checkpoint 5

Run: `cd apps/web && $env:MONGOMS_SYSTEM_BINARY="<mongod path>"; $env:PW_CHANNEL="msedge"; npx playwright test`
(`PW_CHANNEL` drives an installed browser; without it Playwright's own Chromium must be installed.) The run starts an isolated in-memory
MongoDB replica set + the real API (`apps/api/scripts/e2e-server.ts`, synthetic seed), the Next.js dev server, and a second-origin
"attacker" page (`apps/web/e2e/attacker-server.mjs`).

| ID | Flow (docs/phase-0/11 §2.1) | desktop Edge/Chromium | mobile 360 px |
|---|---|---|---|
| E2E-01 | Login, reload, new tab, HttpOnly + SameSite=Lax cookie, not readable by page JS, logout invalidates other tab and back button; wrong password generic error | pass | pass |
| E2E-02 | CSRF: fetch + form forgeries from a second origin with the victim's cookies; foreign `Origin` and missing custom header → 403 `CSRF_REJECTED`; victim still logged in | pass | pass |
| E2E-03 | Tenant switching: data switches school; stale tab gets 409 and reloads into the new school; no cross-school admission numbers visible | pass | pass |
| E2E-04 | Attendance: teacher sees only the assigned section; mark, simulated network drop → clear error → retry/double-click saves once; reload shows saved values; other section refused (403) | pass | pass |
| E2E-05 | Mobile: no horizontal scroll, tap targets ≥ 36 px (controls are 44 px), hamburger menu, login → attendance → submit | pass | pass |
| E2E-06 | Import wizard: upload CSV → columns auto-matched → check → problem row shown with reason → import 2 → students searchable → undo removes them; teacher has no Imports link and the API answers 403 | pass | pass |
| E2E-07 | Add student → add guardian → portal blocked until verified → verify → enable portal → edit twice (no stale-version error) → export CSV download (BOM, re-importable headers) | pass | pass |
| E2E-08 | Every one of the 13 owner sidebar screens loads with no error alert and no horizontal scroll; teacher sees no setup/admin links; owner creates class + section (capacity shown) and a holiday | pass | pass |
| **Total** | 13 specs × 2 projects | **26 passed, 0 failed** | |

Limits of this evidence: Edge (Chromium engine) only — WebKit/Firefox and a real phone have not been run; the Next.js *development* server was used (production-topology proxy of ADR-2 not yet exercised); Screen coverage is functional, not visual; accessibility has not been audited with a screen reader.

## Defects found by the tests and fixed (not hidden)
1. `PlatformRepository.updateOne/updateMany/count/deleteMany/aggregate` returned lazy Mongoose queries that executed **after** the `runAsPlatform` scope ended → the tenancy plugin correctly failed closed ("Tenant context missing"). Fixed by awaiting inside the scope. (Demonstrates lock 3 fail-closed behaviour.)
2. Argon2 test parameters violated the library minimum (`timeCost ≥ 2`) → fixed.
3. (E2E) The seeding helper's origin was missing from the E2E server's allow-list (the CSRF guard correctly refused it); an edit accidentally disabled the E2E server's rate-limit flag; Next's route announcer shares `role=alert` with our alerts; the E2E `login()` helper did not wait for navigation — all test-harness defects, fixed.
3b. Two tenancy tests had incorrect assumptions (lazy query escaping scope; synchronous throw) → tests corrected and a new test added that asserts an escaped lazy query fails closed.
4. A test named "last owner cannot be demoted" did not exercise that rule → replaced by precise tests (only an Owner may demote/suspend an Owner; self-modification forbidden).

5. Re-admitting a withdrawn student into another section kept the old roll number (Mongoose drops `undefined` from `$set`) and hit the roll-number unique index → fixed with explicit nulls; covered by the lifecycle test.
6. The isolation harness initially failed on purpose for routes/resource kinds without a School B fixture (coverage gate) → fixtures and attack specs added for every id-bearing route.

7. (E2E, checkpoint 5) The attendance "Saved N students" confirmation was cleared by the automatic refetch that follows a save (so it could vanish at once) → the message now resets only when section/date changes.
8. (E2E) The import page overflowed horizontally at 360 px (grid items with truncated text need `min-width: 0`) → fixed.
9. (E2E) Two test-side issues: a non-exact link name that became ambiguous once "Attendance reports" was added; a new test that created a class in the school the attendance tests count sections of → moved to the other school.

## Not yet covered (tracked in PROGRESS.md)
- E2E on WebKit/Firefox and real devices; E2E against the production-style reverse-proxy topology.
- Tests for modules not yet built (fees, exams, portals, …). Import UI is not yet E2E-tested.
- Background job queue tests (R3), PDF Hindi rendering spike (R2).
- Performance, restore drill, tenant export/purge/restore round-trip (Phase 7).
