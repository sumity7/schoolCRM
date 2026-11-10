# Remaining Features — Progress (resume file)

> Resume rule: read this file first, continue from NEXT ACTION. Do not repeat completed work. No commits/pushes/deploys in this phase. Never delete or reset `apps/api/.data/mongo-dev`.

Baseline at start (2026-11-10): API 178/178 tests, 40 browser tests passed (see TEST-REPORT.md), working tree = commit `3885753` plus uncommitted `.env.example` / `package-lock.json` changes.

## Phase status
| Phase | Scope | Status |
|---|---|---|
| A | Audit; student login + portal; parent portal enhancements; login-page demo accounts | IN PROGRESS (student portal + demo login DONE & verified; parent enhancements + student documents open) |
| B | Timetable; homework; academic calendar | NOT STARTED |
| C | Admissions; library; transport | NOT STARTED |
| D | 2FA recovery; support access; notification center; SMS/WhatsApp adapters | NOT STARTED |
| E | Platform billing; advanced reporting; inventory; certificates/documents | NOT STARTED |
| F | UI/UX audit; security audit; performance; regression; production docs; dev automation | NOT STARTED |

## Completed in this phase
- Audit → REMAINING-FEATURES-MATRIX.md.
- **Student login + portal (§3)**: staff-issued one-time activation (no passwords visible to staff), login id `<admission>@<school>.student`, activate/deactivate/reissue, own-record-only `/student/*` API (me, attendance, results, report card, fees, notices), per-school portal policy (fees/rank/results visibility), student home + `/app/me` screens, role-template sync (`npm run sync-roles` / boot) for the 26 new permission keys. Tests: `student-portal.test.ts` (7), isolation harness extended (20/20).
- **Login-page demo accounts (directive B)**: server flag `DEMO_LOGIN_ENABLED` (default on only when `NODE_ENV=development`; app refuses to boot with it on in production/staging); `GET /auth/demo-accounts` exists only when the flag is on and returns credentials only for accounts that really exist and whose password really works; six cards on `/login` (fill only — never auto-submit; clear button; password toggle); redirects come from the real server role; idempotent additive seeder `npm run seed:demo` (ran against the dev DB: added root/accountant/parent/student demo logins, existing demo school untouched).
  - Evidence (run 2026-11-10): `demo-login.test.ts` 5/5; full API suite **190/190**; `eslint .` clean; typecheck clean (api, web, shared); browser `e2e/demo-login.spec.ts` **11/11 on desktop-chromium and 11/11 on mobile-360**; production build + `npm run check:bundle --workspace @edunex/web` → 2418 files scanned, none contains any demo credential, demo copy or the `/auth/demo-accounts` path.
  - Note: the full browser suite (all older specs) was NOT re-run after this change set; only the new spec was. Run `npm run test:e2e` before relying on the older E2E numbers.

## NEXT ACTION
Phase A leftovers: browser E2E for the student journey (activation link → set password → dashboard) and parent child-switching; parent enhancements (guardian profile, notification preferences, timetable/homework visibility once those exist). Then Phase B (timetable, homework + file storage, academic calendar view). Re-run the whole browser suite before declaring Phase A complete.

## Operational notes
- E2E on this machine: port 4100 may be held by a stale API process I did not start → use `E2E_API_PORT=4101` (and `PW_REUSE_SERVERS` only if you started the servers yourself). Do NOT run a production `next build` while a dev/E2E web server uses `apps/web/.next` (it corrupts the dev cache → spurious E2E failures; delete `.next` and rerun).
- Demo logins (development only, synthetic, password `Correct-Horse-9`): owner@demo.test (School Admin), tina@demo.test (Teacher), accountant@demo.test, parent@demo.test, demo-a1@demo.student, root@demo.test (Super Admin — must enrol TOTP on first use; platform staff MFA is mandatory).

## Decisions made in this phase
- Student login ids are e-mail-shaped (`…@<schoolcode>.student`) so the existing login form/identity model is reused; no student e-mail is assumed.
- Demo credentials are served by a dev-only API route (never embedded in the web bundle) and each is verified against the real auth system before being offered.
