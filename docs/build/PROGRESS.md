# PROGRESS TRACKER (updated at every checkpoint)

> **Resume rule:** read this file first. Continue from "NEXT ACTION". Do not re-ask decisions listed in DECISION-LOG.md.
> Honest status vocabulary: `NOT STARTED` · `IN PROGRESS` · `CODE WRITTEN (untested)` · `TESTED` (tests actually executed and passing, with counts in TEST-REPORT.md) · `DEFERRED`.

Last updated: 2026-11-10 (session 2, checkpoint 6)

## Release map

| Release | Scope | Status |
|---|---|---|
| R1 | Student management & attendance foundation | IN PROGRESS |
| R2 | Fees & financial management | NOT STARTED |
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
| 7b | Deployment docs (ADR-2 proxy), performance test, security review pass | NOT STARTED |
| Web | R1 screens: auth, grouped role-filtered nav, dashboard, attendance (+ correction requests), attendance reports (CSV), corrections queue, students list (filters/export), add student, student profile (edit/status/guardians/attendance), import wizard, staff, academic sessions, classes/sections/subjects/teacher assignments, holidays, users & roles, school settings/policies, audit log. Production build passes. | **TESTED** (E2E 26/26, desktop + 360 px) |

## NEXT ACTION
1. R1 remaining: (a) ~~web screens~~ done at checkpoint 5 (still missing, lower priority: own profile/password/sessions page, onboarding checklist); (b) ~~CSV import/export~~ done; (c) ~~backups/tenant tools~~ done at checkpoint 6; (d) deployment docs (ADR-2 reverse proxy), performance test with realistic dataset, security review pass; (e) `docs/build` remaining files (ARCHITECTURE, SETUP, ENVIRONMENT, DEPLOYMENT, SECURITY-REPORT, MASTER-IMPLEMENTATION-PLAN, traceability matrix).
2. R2 Fees & ledger (start with the pdfmake Hindi rendering spike, ADR-6). R3 (re-evaluate job queue first, ADR-5), R4, R5.
3. Never mark a release done without its acceptance tests (docs/phase-0/11).

## Housekeeping for the user
- A first rehearsal run hung (harness bug, fixed). Its processes could not be stopped from the session: node PIDs 13712, 31380, 27784, 17052, 7280 and mongod PID 25372 (temp dir `mongo-mem-OqV8qr`). Safe to end them in Task Manager.

## Recovery points (git)
See `git log` in the repository root (local repository, no remote configured).
