# PROGRESS TRACKER (updated at every checkpoint)

> **Resume rule:** read this file first. Continue from "NEXT ACTION". Do not re-ask decisions listed in DECISION-LOG.md.
> Honest status vocabulary: `NOT STARTED` · `IN PROGRESS` · `CODE WRITTEN (untested)` · `TESTED` (tests actually executed and passing, with counts in TEST-REPORT.md) · `DEFERRED`.

Last updated: 2026-11-09 (session 1, checkpoint 1)

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
| 2 | Monorepo, TS strict, lint rules, env validation, logging, DB, errors, test infra | **TESTED** — 89/89 API tests pass; tsc strict + eslint clean (docs/build/TEST-REPORT.md) |
| 3a | Tenancy primitives (context, registry, plugin, repository, platform repo) | **TESTED** (89/89 pass)
| 3b | Identity: users, Argon2id, sessions, login/logout, lockout, CSRF, reset, invite | **TESTED** (89/89 pass)
| 3c | Membership binding, select-school, stale-tab assertion | **TESTED** (89/89 pass)
| 3d | RBAC (roles as data, route manifest, deny-by-default, grant-subset rule, owner protection) | **TESTED** (89/89 pass)
| 3e | Audit service + isolation harness v1 | **TESTED** (89/89 pass)
| 3f | Idempotency + sequences (kernel) | **TESTED** (concurrency: 50 parallel sequence allocations, 10 parallel idempotent requests) |
| 3g | Playwright E2E (login/session persistence, CSRF second-origin, tenant switching) | NOT STARTED (needs web app) |
| 4 | School setup: academics (sessions/classes/sections/subjects/assignments/holidays), users & roles screens, CLI provisioning | CLI DONE (untested); academics NOT STARTED |
| 5 | Students, guardians (+links), staff-basic, CSV/XLSX import/export | NOT STARTED |
| 6 | Attendance (+corrections, audit, reports) + E2E attendance/mobile | NOT STARTED |
| 7 | Hardening, backups + restore scripts, tenant export/purge/restore, deployment docs | NOT STARTED |
| Web | Next.js app shell, auth screens, role dashboards | NOT STARTED |

## NEXT ACTION
1. (done) Kernel + auth + tenancy + RBAC tested. Test runs reuse the local mongod via `MONGOMS_SYSTEM_BINARY` (see TEST-REPORT.md).
2. Finish `apps/web`: ui primitives, login/select-school/forgot/reset/accept-invite pages, app shell + dashboard + users + settings + audit pages; typecheck + build; then Playwright E2E (login/session persistence, CSRF second-origin, tenant switching/stale tab). Previously: scaffold `apps/web` (Next.js App Router + Tailwind + shadcn/ui) with API proxy rewrites, login + select-school + dashboard shell, then Playwright critical flows.
4. Academics module (phase 4), then students/guardians/import (phase 5), attendance (phase 6).

## Recovery points (git)
See `git log` in the repository root (local repository, no remote configured).
