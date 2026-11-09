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

## Latest run — checkpoint 2 (2026-11-09, session 1)

| Suite | File | Tests | Result |
|---|---|---|---|
| Tenancy kernel (locks 2–4, transactions) | `src/core/tenancy/tenancy.test.ts` | 22 | **22 passed** |
| Kernel: sequences, idempotency, audit redaction, rate limit, env validation | `src/core/kernel.test.ts` | 12 | **12 passed** |
| Shared package: identifiers, calendar days, permission catalogue/roles | `src/shared.test.ts` | 8 | **8 passed** |
| Auth, sessions, CSRF, reset/invite, tenant switching, hygiene | `test/auth.test.ts` | 29 | **29 passed** |
| Route manifest, isolation harness v2 (all id-routes attacked with School B ids + byte-for-byte snapshot; collection-route leak sweep), RBAC/escalation, audit | `test/rbac-isolation.test.ts` | 18 | **18 passed** |
| R1 domain: academics, students, guardians, attendance (scope, dates, corrections, percentages, concurrency) | `test/r1-domain.test.ts` | 25 | **25 passed** |
| Lint canaries (the architecture rules actually fire) | `test/lint-rules.test.ts` | 4 | **4 passed** |
| **Total** | 7 files | **118** | **118 passed, 0 failed, 0 skipped** |

Static checks at the same commit: `tsc --noEmit` (strict) clean; `eslint apps packages --max-warnings 0` clean.

## Defects found by the tests and fixed (not hidden)
1. `PlatformRepository.updateOne/updateMany/count/deleteMany/aggregate` returned lazy Mongoose queries that executed **after** the `runAsPlatform` scope ended → the tenancy plugin correctly failed closed ("Tenant context missing"). Fixed by awaiting inside the scope. (Demonstrates lock 3 fail-closed behaviour.)
2. Argon2 test parameters violated the library minimum (`timeCost ≥ 2`) → fixed.
3. Two tenancy tests had incorrect assumptions (lazy query escaping scope; synchronous throw) → tests corrected and a new test added that asserts an escaped lazy query fails closed.
4. A test named "last owner cannot be demoted" did not exercise that rule → replaced by precise tests (only an Owner may demote/suspend an Owner; self-modification forbidden).

5. Re-admitting a withdrawn student into another section kept the old roll number (Mongoose drops `undefined` from `$set`) and hit the roll-number unique index → fixed with explicit nulls; covered by the lifecycle test.
6. The isolation harness initially failed on purpose for routes/resource kinds without a School B fixture (coverage gate) → fixtures and attack specs added for every id-bearing route.

## Not yet covered (tracked in PROGRESS.md)
- Browser E2E (Playwright): login/session persistence, CSRF from a second origin, tenant switching/stale tab, attendance submission, mobile workflows — **not yet written/executed** (web app in progress).
- Tests for modules not yet built (academics, students, import, attendance, fees, …).
- Background job queue tests (R3), PDF Hindi rendering spike (R2).
- Performance, restore drill, tenant export/purge/restore round-trip (Phase 7).
