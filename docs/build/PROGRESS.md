# PROGRESS TRACKER (updated at every checkpoint)

> **Resume rule:** read this file first. Continue from "NEXT ACTION". Do not re-ask decisions listed in DECISION-LOG.md.
> Honest status vocabulary: `NOT STARTED` · `IN PROGRESS` · `CODE WRITTEN (untested)` · `TESTED` (tests actually executed and passing, with counts in TEST-REPORT.md) · `DEFERRED`.

Last updated: 2026-11-09 (session 1, checkpoint 2)

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
| 3g | Playwright E2E: login/session persistence, CSRF second-origin, tenant switching/stale tab | NOT STARTED (web UI in progress) |
| 4 | Academics API: sessions, classes, sections, subjects, teacher assignments, holidays; staff API; CLI provisioning | **TESTED** (API); CLI untested |
| 5a | Students, enrolments, guardians + verified links, lifecycle (transfer/withdraw/graduate/re-admit), search | **TESTED** (API) |
| 5b | CSV import (mapping/preview/errors/commit/rollback) + CSV export | NOT STARTED |
| 6 | Attendance API: sheet, bulk save (all-or-nothing), corrections + approval, history, monthly + low-attendance reports | **TESTED** (API) |
| 6e | E2E: attendance submission + mobile workflows | NOT STARTED |
| 7 | Hardening: backup/restore scripts, tenant export/purge/restore, deployment docs, perf test | NOT STARTED |
| Web | Next.js: shell + auth pages written (partial, untested); module screens NOT STARTED | IN PROGRESS |

## NEXT ACTION
1. Typecheck/build `apps/web`; build screens: login / select-school / forgot / reset / accept-invite, app shell, dashboard, users, school settings, academics setup, students (list/profile/create), attendance marking (mobile-first), corrections queue, reports.
2. Playwright E2E (E2E-01..05, doc 11 §2.1) against a seeded API (`apps/api/scripts/e2e-server.ts`, to be written).
3. CSV import/export (phase 5b), tenant export/purge/restore + backup scripts (phase 7), then R2 (fees).

## Recovery points (git)
See `git log` in the repository root (local repository, no remote configured).
