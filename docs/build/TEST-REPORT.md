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

## Latest run — checkpoint 9 (2026-11-10, session 2)

| Suite | File | Tests | Result |
|---|---|---|---|
| Tenancy kernel (locks 2–4, transactions) | `src/core/tenancy/tenancy.test.ts` | 22 | **22 passed** |
| Kernel: sequences, idempotency, audit redaction, rate limit, env validation | `src/core/kernel.test.ts` | 12 | **12 passed** |
| Shared package: identifiers, calendar days, permission catalogue/roles | `src/shared.test.ts` | 8 | **8 passed** |
| Auth, sessions, CSRF, reset/invite, tenant switching, hygiene | `test/auth.test.ts` | 29 | **29 passed** |
| Route manifest, isolation harness v2 (all id-routes — incl. import and 23 fee routes — attacked with School B ids + byte-for-byte snapshot; School B ids inside finance request bodies; collection-route leak sweep incl. CSV bodies), RBAC/escalation, audit | `test/rbac-isolation.test.ts` | 19 | **19 passed** |
| R1 domain: academics, students, guardians, attendance (scope, dates, corrections, percentages, concurrency) | `test/r1-domain.test.ts` | 25 | **25 passed** |
| Lint canaries (the architecture rules actually fire) | `test/lint-rules.test.ts` | 4 | **4 passed** |
| Import/export: CSV parser + formula-injection sanitiser, date parsing, mapping; 1,000-row/30-bad acceptance, re-import duplicates, class/section/roll/capacity/plan-limit validation, sibling guardian reuse, idempotent commit, rollback of untouched rows only, transaction-join proof, RBAC; student + attendance CSV exports (audited, re-importable) | `test/imports.test.ts` | 17 | **17 passed** |
| Backups & tenant portability: encrypted archive round trip with digest verification, wrong passphrase / tampering / truncation write nothing, short passphrase refused, existing file never overwritten, restore drill, GFS retention, export → purge (guards, other school byte-identical, sessions die) → restore → password reset | `test/backup.test.ts` | 6 | **6 passed** |
| Fees (R2): money arithmetic + allocation property test; structures/versions; idempotent billing; concessions & limits; payments/advance/receipt numbering; 30-way concurrency; receipt PDF; reversals/refunds/separation of duties; day close; ledger invariant property test over random operations; reports | `test/fees.test.ts` | 18 | **18 passed** |
| R3: job queue (retry/backoff/dead-letter/de-dup/lease recovery), parent invitation + portal, link-based access re-checked per request, siblings, receipts, notices (audiences, e-mail dedup + idempotency, read receipts, teacher limits) | `test/parents-notices.test.ts` | 6 | **6 passed** |
| R4: grading rules (boundaries, incomplete/absent/exempt, ranking, determinism); exam workflow with scoped marks entry, immutability, versioned correction, parent report card | `test/exams.test.ts` | 5 | **5 passed** |
| R5: year-end promotion (all-or-nothing, replace decisions, old year byte-identical, finalize on activation) | `test/promotion.test.ts` | 1 | **1 passed** |
| R5: TOTP (RFC 6238 vectors, encrypted secrets), two-step sign-in, platform console (MFA required, support read-only, suspend/reactivate, counts only, audit) | `test/platform-mfa.test.ts` | 4 | **4 passed** |
| **Total** | 14 files | **178** | **178 passed, 0 failed, 0 skipped** |

Static checks at the same commit: `tsc --noEmit` (strict) clean; `eslint apps packages --max-warnings 0` clean.

## Browser E2E (Playwright) — checkpoint 8

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
| E2E-10 | Parent portal: owner posts a section notice → parent sees only their child, attendance, the notice (read receipt stored); staff screens absent and `/students` answers 403 | pass | pass |
| E2E-11 | Exams: grading scale → exam → subjects → teacher enters marks for her section only → owner completes, locks, computes, publishes → parent sees the result and downloads the report card | pass | pass |
| E2E-12 | Platform console: password → wrong code rejected → correct code → real counts, no student data → create school → audit entry; school staff refused | pass | pass |
| E2E-09 | Fee desk: bill an instalment from the Invoices screen → collect a part-payment (confirmation shows allocation) → receipt number format → receipt PDF bytes via the proxy → balance drops by exactly the amount → reversal request; requester gets no Approve button; teachers see no fee screens and the API answers 403 | pass | pass |
| **Total** | 15 specs × 2 projects | **30 passed** | |

Checkpoint-8 full run: 28/30 passed; the 2 failures were the screen-sweep test (now 20 screens) exceeding its 60 s budget while the dev server compiled routes. Its budget was raised and it was re-run: 2/2 passed. The other 28 were not re-run after that change.

Limits of this evidence: Edge (Chromium engine) only — WebKit/Firefox and a real phone have not been run; the Next.js *development* server was used (production-topology proxy of ADR-2 not yet exercised); Screen coverage is functional, not visual; accessibility has not been audited with a screen reader.

## Performance (checkpoint 7)
`npx tsx scripts/perf.ts` — throw-away replica set; school "perf": 2,000 students imported through the real import API,
36 sections, ~6 months of attendance; school "noise": 500 students; 333,500 attendance records in total. All requests over
real HTTP; MongoDB profiler on during measurement. Local Windows machine, DB and API on the same host. Final run:

| Request | p50 ms | p95 ms | target p95 |
|---|---|---|---|
| students list / search / section filter | 13 / 18 / 14 | 16 / 24 / 17 | < 500 |
| student profile / 60-day attendance history | 9 / 14 | 16 / 26 | < 500 |
| attendance sheet (section, today) | 15 | 23 | < 500 |
| monthly report (section) | 24 | 34 | < 500 |
| low-attendance report (whole school, session) | 359 | 476 | < 1,500 |
| save attendance, 60 students | 34 | 42 | < 1,500 |
| students list, 10 concurrent users | 47 | 72 | < 500 |
| export 2,060 students (CSV) | 120 | 127 | < 3,000 |

No COLLSCAN on application collections. First run found the low-attendance report at p95 4.8 s (all records loaded into Node)
→ fixed with a DB-side aggregation (p95 2.3 s) plus a covering index (p95 0.48 s). The 2,000-row import commit took 2.2–6.9 s
across runs (no target; machine load varied). Limits: one machine, loopback network, synthetic data, no production host.

## Production build checks (checkpoint 7)
Bundled API (`dist/server.js`, `dist/cli.js`) served health/login/students and bound 127.0.0.1; production mode refused a
localhost DB and an http base URL. Next standalone build served pages, static assets, security headers and the full CSP;
a real Edge session logged in, used 6 screens, downloaded the CSV and switched theme with **no CSP violations or page errors**.
Found while doing this: with the API on IPv4 loopback, the rewrite target `http://localhost:4000` could resolve to IPv6 `::1`
and miss the API → targets changed to `127.0.0.1`. Caddy/systemd were NOT exercised (not installed here).

## Backup/restore rehearsal (real CLI, checkpoint 6)
`npx tsx scripts/backup-rehearsal.ts` — throw-away replica set (MongoDB 8.3.4 binary), 2 synthetic schools × 80 students seeded via the API,
every step run as a separate `scripts/cli.ts` process. Run of 2026-11-10: **PASS**.

| Step | Time |
|---|---|
| backup (whole DB, encrypted) | 2.0 s |
| restore-drill (22 collections, 564 docs, digests + sanity checks) | 4.6 s (restore part 3.2 s) |
| restore into a new DB; second restore into the same DB refused | 4.4 s |
| export-school alpha (279 docs) | 1.5 s |
| purge refused while not deactivated → deactivate → purge | 2.4 s |
| restore-school alpha (2 users recreated, must reset password) | 2.9 s |

Limits: tiny synthetic dataset on a local machine; not yet run on a production host or with off-site storage (needs hosting).

Checkpoint-9 browser evidence, stated precisely: 40 tests (20 specs × 2 viewports). One full run was cut short when the dev web server on :3100 died mid-run (the exams test then hung 14 min and later tests failed in milliseconds — an environment failure, no product error). Everything before that point passed (34 results incl. all of E2E-01…E2E-06, E2E-09, E2E-10, E2E-12 on both viewports); the exams, import, student-record and screen-sweep specs were re-run afterwards on both viewports: 14/14 passed. **No single uninterrupted 40/40 run exists.** `PW_REUSE_SERVERS=1` was added so a run can reuse servers left by an earlier run (default stays strict).

## Defects found while building R3–R5 (not hidden)
20. (R3) A parent could reach a staff report (low-attendance) because `attendance:read` is granted at `own` scope and the route accepted any scope → **own-scope is now denied on every route unless the route opts in**; a manifest test pins the exact allow-list.
21. (R3 E2E) After another tab switched school, the first tab only noticed on its next API call → the tab now reloads as soon as `/auth/me` shows a different school (E2E-03 failed once in 32 full-suite runs on desktop and passed 3/3 repeats; the cause was not proven, this change removes the timing window).
22. (R4) Report-card PDF used an italic font face that is not vendored → 500; italic removed (bold used instead).
23. (R5 test) A screen-sweep entry listed the Security page as a sidebar link; it is a header link → test fixed.
24. (R5 E2E) A full run immediately after `next build` in the same `.next` folder failed 4 tests (webpack cache errors in the log); the two product tests passed when re-run alone. Builds and the E2E dev server must not share `.next` at the same time.

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

10. (backup tests) When the target backup file already existed, the failure-cleanup path deleted the EXISTING file → the file is now opened exclusively before anything else and only files this run created are cleaned up.
11. (backup tests) Writing through a raw fd taken from a `FileHandle` let garbage collection close it mid-write → the handle's own stream is used.
12. (rehearsal #1) The rehearsal harness used `spawnSync`, blocking the event loop that drains the in-memory mongod's log pipe; mongod stalled and the run hung during the drill → async spawn with a per-step timeout. Six processes of that hung run could not be stopped from this session (permission policy) and are listed in PROGRESS.md.

13. (perf) Whole-school low-attendance report too slow (p95 4.8 s) → aggregation + covering index; `summariseCounts` proven equal to `summariseAttendance` by a unit test.
14. (prod build) Next standalone bundle traced files from the wrong root (a stray lockfile in the user folder) → `outputFileTracingRoot` set.
15. (prod build) `localhost` vs `127.0.0.1` rewrite target (IPv6 resolution) → explicit IPv4.
16. (run) `scripts/dev-db.ts` left an unusable data folder after a failed first start → `DEV_DB_PATH` override added; the broken folder `apps/api/.data/mongo` is left for the user to delete.

17. (fees, test-side) `-0 ≠ 0` in the invariant helper; too-short platform-read reason; ambiguous labels in E2E — fixed in the tests.
18. (fees) ESLint caught a misleading Unicode character class in the script-run splitter → replaced with explicit code-point ranges.
19. (fees E2E) Playwright returns an empty body for a response the page consumed as a blob — the test re-requests the same URL through the same proxy and checks the PDF bytes.

## Not yet covered (tracked in PROGRESS.md)
- E2E on WebKit/Firefox and real devices; E2E against the production-style reverse-proxy topology.
- Tests for modules not yet built (fees, exams, portals, …). Import UI is not yet E2E-tested.
- Background job queue tests (R3), PDF Hindi rendering spike (R2).
- Restore drill and performance on the real host; Caddy/systemd/TLS; E2E against the proxy topology; external security review.
