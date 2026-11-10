# PROGRESS TRACKER (updated at every checkpoint)

> **Resume rule:** read this file first. Continue from "NEXT ACTION". Do not re-ask decisions listed in DECISION-LOG.md.
> Honest status vocabulary: `NOT STARTED` · `IN PROGRESS` · `CODE WRITTEN (untested)` · `TESTED` (tests actually executed and passing, with counts in TEST-REPORT.md) · `DEFERRED`.

Last updated: 2026-11-10 (session 2, checkpoint 8)

## Release map

| Release | Scope | Status |
|---|---|---|
| R1 | Student management & attendance foundation | **TESTED** locally; go-live gate needs hosting (D-26/D-28) |
| R2 | Fees & financial management | **TESTED** (API + UI + E2E); real-money parallel run (Gate G8) NOT DONE |
| R3 | Parent portal & communication | NOT STARTED |
| R4 | Exams & academic management | NOT STARTED |
| R5 | Promotion & Super Admin console | NOT STARTED |

## R1 phase checklist

| Phase | Item | Status |
|---|---|---|
| 1 | Architecture finalisation / ADRs approved | DONE (docs/phase-0/16, DECISION-LOG) |
| 2 | Monorepo, strict TS, lint rules (+canary tests), env validation, logging, DB, errors, test infra | **TESTED** |
| 3a–3f | Tenancy kernel, identity/sessions/CSRF, membership binding, RBAC, audit, isolation harness, idempotency, sequences | **TESTED** (118/118 API tests; docs/build/TEST-REPORT.md) |
| 3g | Playwright E2E: login/session persistence, CSRF second-origin, tenant switching/stale tab | **TESTED** (14/14, desktop + 360 px) |
| 4 | Academics API: sessions, classes, sections, subjects, teacher assignments, holidays; staff API; CLI provisioning | **TESTED** (API); CLI untested |
| 5a | Students, enrolments, guardians + verified links, lifecycle (transfer/withdraw/graduate/re-admit), search | **TESTED** (API) |
| 5b | CSV import (upload → auto-mapping → validate/preview → error CSV → idempotent commit of valid rows → rollback of untouched rows) + CSV exports (students, monthly + low attendance), formula-injection safe | **TESTED** (API 135/135; UI E2E-06) |
| 6 | Attendance API: sheet, bulk save (all-or-nothing), corrections + approval, history, monthly + low-attendance reports | **TESTED** (API) |
| 6e | E2E: attendance submission + mobile workflows | **TESTED** (14/14) |
| 7a | Encrypted backups + retention, restore, restore drill, per-school export/purge/restore (CLI), rehearsal script, runbook (docs/build/BACKUP-RESTORE.md) | **TESTED** (6 tests + real-CLI rehearsal PASS); production-host drill NOT DONE (no hosting) |
| 7b | Deployment kit (Caddy, systemd, env templates, DEPLOYMENT.md), production startup guards, bundled CLI, performance test (all targets met), security review pass 1 (SECURITY-REPORT.md) | **TESTED** locally (perf PASS, prod bundles smoke-tested, 142 API + 26 E2E); real host NOT DONE |
| Web | R1 screens: auth, grouped role-filtered nav, dashboard, attendance (+ correction requests), attendance reports (CSV), corrections queue, students list (filters/export), add student, student profile (edit/status/guardians/attendance), import wizard, staff, academic sessions, classes/sections/subjects/teacher assignments, holidays, users & roles, school settings/policies, audit log. Production build passes. | **TESTED** (E2E 26/26, desktop + 360 px) |

## R2 checklist (checkpoint 8)
| Item | Status |
|---|---|
| ADR-6 Hindi PDF spike (pdfmake + Noto fonts) | **PASSED** (visual check; copy/paste extraction of Devanagari is scrambled — known) |
| Fee heads, versioned structures (draft → publish → revise), fee policy (D-06…D-09 defaults) | **TESTED** |
| Concessions with auto-approve limit and second-person approval | **TESTED** |
| Invoice generation (idempotent, never double-bills, re-bill after void), late fee, adjustment, void | **TESTED** |
| Payments: oldest-first allocation, advance credit auto-applied, receipt number per FY inside the transaction, Idempotency-Key, receipt PDF | **TESTED** (incl. 30 parallel payments, same-key ×10) |
| Reversals and refunds with separation of duties; day close / re-open | **TESTED** |
| Ledger invariant (property test over random operation sequences) | **TESTED** |
| Collection / outstanding reports + CSV; dashboard tiles; student fees card | **TESTED** |
| Fee screens: collect, invoices, payments, concessions, approvals, reports + day close, setup | **TESTED** (E2E-09 + screen sweep, desktop + 360 px) |
| Not built: online payments (D-28: flag off), automatic late fees (D-08 default manual), cheque-bounce charges, fee carry-forward at session rollover (with R5 promotion), parent fee view (R3) | — |

## NEXT ACTION
1. R1 remaining: (a) ~~web screens~~ done at checkpoint 5 (still missing, lower priority: own profile/password/sessions page, onboarding checklist); (b) ~~CSV import/export~~ done; (c) ~~backups/tenant tools~~ done at checkpoint 6; (d) ~~deployment docs, perf test, security review~~ done at checkpoint 7 (real-host steps need hosting); (e) `docs/build` remaining files (ARCHITECTURE, SETUP, ENVIRONMENT, DEPLOYMENT, SECURITY-REPORT, MASTER-IMPLEMENTATION-PLAN, traceability matrix).
2. ~~R2 Fees & ledger~~ done at checkpoint 8. Next: R3 (re-evaluate job queue first, ADR-5; decide parent login D-03 default), then R4 exams, R5 promotion + Super Admin console.
3. Never mark a release done without its acceptance tests (docs/phase-0/11).

## Housekeeping for the user
- Processes started by the agent that it was not permitted to force-stop: the `npx`-spawned dev web (:3000) and dev API (IPv6 :4000) from the checkpoint-7 run, plus the dev MongoDB (`.data/mongo-dev`). End them in Task Manager when done.
- `apps/api/.data/mongo` is an unusable data folder from a failed dev-db start (contains nothing of value) — delete it, or keep using `DEV_DB_PATH`.

## Recovery points (git)
See `git log` in the repository root (local repository, no remote configured).
