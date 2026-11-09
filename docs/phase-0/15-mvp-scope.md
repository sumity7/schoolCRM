# O. Prioritised MVP Scope — First Pilot School (Revision 3)

> **Revision 2 — D-04 and D-19 confirmed:** development time is **5–10 hours/week** (solo, AI-assisted, including learning and review) and production budget is **₹0/month**. The earlier plan (one MVP drop, 8–9 months at 20–30 h/week) is **withdrawn**. Delivery is now a sequence of small releases **R1–R5**; **R1 is the smallest usable pilot**. Effort is in §7; the go-live gate is [doc 12 §10](12-deployment-infra.md). Nothing in the security / tenant-isolation / ledger-integrity / backup-and-restore scope was reduced to shorten the timeline.

> **Revision 3 — decisions recorded:** Option A confirmed (D-27); 7.5 h/week planning baseline (D-29); generic CBSE-style design, no CBSE hard-coding (D-01, provisional). **R1 is a student-management and attendance pilot — not a complete operational School ERP** (see §1B and §1D). The five-release plan and all security and production-readiness gates are unchanged. Critical Playwright E2E tests are kept in full (doc 11 §2.1); estimates were raised accordingly (§7).

## 1. MVP definition
**The smallest product a real private school can use for daily operations while keeping Excel as a parallel backup for a month.** It must be secure and tenant-safe from day one — those are not "later" features.

**MoSCoW against the pilot's top jobs:** 1) know who is in which class, 2) mark attendance, 3) collect fees and issue correct receipts, 4) tell parents things / let parents see their child's basics, 5) record exam marks and print results.

## 1A. Release plan (replaces the single-drop MVP)

| Release | Content | Why in this order |
|---|---|---|
| **R1 — Student Management & Attendance Pilot (smallest usable pilot)** | Kernel (identity, tenancy, RBAC, audit, isolation harness) + school setup + students/guardians/staff-basic + CSV import + **daily attendance** + backups/restore/deploy + go-live gate | Exercises *every* security-critical mechanism with the lowest financial risk; produces something teachers use daily; builds your skills before the finance module |
| **R2 — Fee desk** | Fee categories/structures/instalments, invoices, manual collection, receipts (PDF), reversal/refund approval, day-book/day-close, dues & collection reports | Highest business value and highest rigour; needs a proven kernel first |
| **R3 — Parents & notices** | Job queue, notices (in-app + email), parent read-only portal (attendance, notices, fees/receipts once R2 exists) | Needs jobs/email and the parent-link model proven in R1 |
| **R4 — Exams** | Grading scales, exams, marks entry, results compute/approve/publish, one report-card template | Needs stable enrolment & staff scope |
| **R5 — Year-end & vendor console** | Promotion/rollover, platform web console (school list, suspend, plans), MFA for platform web login | See "deadline-bound" note in §1C |

**Ordering decided (D-27): Option A — attendance before fees.** Option B (fees first) was considered and **not selected**.

## 1B. R1 — Student Management & Attendance Pilot (the smallest usable pilot)

**What R1 is:** a secure, multi-tenant system for keeping the **student/guardian/staff directory** and recording **daily class attendance**, with tenant isolation, audit trail, backups and a production-readiness gate. **What R1 is not:** a complete operational School ERP. A school using R1 still runs fees, parent communication, exams, timetable and administration in its existing tools (see §1D).

**In R1**
- **Provisioning by CLI scripts** (`create-super-admin`, `create-school`, `invite-owner`, `set-limits`, `suspend-school`) — *no web Super-Admin login exists in R1* (smaller attack surface, no platform UI to build).
- **Auth:** email+password login/logout, forgot/reset, invite-accept, change password, session list/revoke, lockout & rate limiting, secure cookies, CSRF; **synchronous email adapter** (needed for invites/resets) with dev sink.
- **Tenancy kernel + isolation harness (suites 1–14 for every R1 route) + RBAC (system roles as data; R1 exercises owner, admin, teacher/class-teacher, with the other roles' rows present but unused) + audit log + simple school-side audit viewer + entitlement-lite (student/staff caps set via CLI).**
- **School setup:** profile, working days, academic session, classes, sections, subjects, teacher assignments, holidays; invite staff & assign roles.
- **People:** students (CRUD, search/filter, status lifecycle, soft-delete semantics), guardians + verified links/flags (built and tested now, used by R3 portal), basic staff profile + class/subject assignment.
- **CSV/XLSX import** for students, guardians, staff: mapping → preview → error report → commit-valid-rows → rollback; **synchronous, capped at ~2,000 rows/file, chunked transactions.** CSV export (formula-injection safe).
- **Attendance:** daily class attendance (mobile-first), bulk save, unique-per-student-day, working-day/holiday rules, edits audited with reason (same-day by teacher; later by class teacher/admin), monthly and low-attendance reports (CSV).
- **Ops:** structured logging, health checks, deployment, backups + **restore drill**, monitoring, runbooks, **Production-Readiness Gate** (doc 12 §10).

**Not in R1** (see §1C): web platform console, MFA UI, job queue, photos/documents upload, parent/student portals, notices, email alerts, fees, exams, promotion, onboarding wizard, custom-role UI, global search palette, XLSX/PDF exports, dashboards beyond counts.

**Honest value statement:** R1 replaces the paper/Excel *attendance register and student directory* only. It does **not** replace fee collection, parent communication, exams or the Super Admin web console. It should be described to schools as a *student-management and attendance pilot*, never as "the ERP". Its commercial appeal on its own is limited; it is the proven, secure foundation on which R2–R5 are built.

## 1C. What can be postponed without compromising the core system

| Postponed item | To | Safe to postpone because | Build *now* so later is not rework |
|---|---|---|---|
| Web Super-Admin console | R5 | CLI covers create/suspend/limits; no web platform login ⇒ fewer attack paths | `PlatformRepository`, `support_grants`/audit schemas, route-manifest `tenancy:'platform'` category |
| Background job queue | R3 | R1 import is sync & capped; email sync | `JobQueue` interface + `jobs` schema; handlers written as pure functions |
| File uploads (photos/documents) | R2/R3 | attendance/directory don't need them | `FileService` interface + `files` schema + tenant-key rules; MIME/size/AV rules when implemented |
| Parent portal | R3 | pilot staff-only; school informs parents as today | Guardian-link model (`verifiedAt`, `portalAccess`, `endedAt`) + tests |
| Notices, email alerts, notification prefs | R3 | not needed to mark attendance | Notification adapter interface, consent fields |
| Fees | R2 (or R1 under Option B) | separable module; highest rigour — better started with a proven kernel | Idempotency + sequence services in kernel |
| Exams/report cards | R4 | | grading config stored as versioned data |
| Promotion / rollover | R5 — **deadline-bound** | not needed until the first session year-end | `enrollments` history model built in R1. **Pull forward ≥ 3 months before the first year-end after go-live (≈ 35 h)** |
| MFA for school staff | post-R5 | lockout + strong passwords + session controls meanwhile | `users.mfa` field & flow design |
| Custom-role UI, onboarding wizard, global search palette | post-R5 | system roles + checklist doc suffice | roles-as-data |
| Admissions pipeline, student portal, timetable, homework, staff attendance/leave, certificates | post-R5 (P1) | not pilot-blocking | module boundaries already defined |
| Library, transport, payroll, inventory, SMS/WhatsApp, online payments, automated billing | P3 | not needed for pilot | adapters stubbed |
| Hindi UI | later | English UI | all strings externalised from day 1 |
| Rich dashboards/charts | later | counts are enough | reports API returns real aggregates |

**Never cut (not even under schedule pressure):** tenant isolation + harness · server-side authorization · audit logging · password/session security · input validation · immutable payments & ledger invariants (when fees ship) · idempotency · backups **and** restore drills · secrets hygiene · the Production-Readiness Gate · no real data outside production.

**Time-savers that don't weaken security:** use shadcn/ui blocks and a ready admin-shell layout; generate OpenAPI from Zod; one report/receipt template; English-only; desktop-first admin screens (mobile only for teacher attendance and parent views); **Playwright E2E is kept in full for the mandatory critical flows** (login/session persistence, CSRF, tenant switching, attendance submission, mobile workflows — doc 11 §2.1). API tests do not replace them and are not a time-saver here.

## 1D. School operations that remain OUTSIDE R1

| Operation | During R1 the school keeps using | Arrives in |
|---|---|---|
| Fee structures, invoices, **fee collection**, receipts, dues, refunds, day-book | existing receipt books / Excel / current software | **R2** |
| **Parent portal** (attendance, fees, results, notices) | existing channels (calls, WhatsApp groups, paper) | **R3** |
| Notices and announcements, email/in-app notifications, absent alerts to parents | existing channels | **R3** |
| Student portal | — | post-R5 |
| **Super Admin web console** (school list/suspend/plans via browser) | **vendor CLI scripts** (no web Super-Admin login exists in R1) | **R5** |
| Exams, marks entry, results, report cards | existing process | **R4** |
| Promotion / year-end rollover | manual or vendor-assisted script (pull forward ≥ 3 months before first year-end) | **R5** |
| Student photos and document uploads | paper/files | R2/R3 |
| Timetable, homework, admissions pipeline, staff attendance & leave, certificates | existing process | post-R5 |
| Library, transport, payroll, inventory | existing process | P3 |
| Online fee payment, SMS/WhatsApp, automated subscription billing | — | P3 / later |
| Onboarding wizard, custom-role UI, global search palette, XLSX/PDF report exports | — | post-R5 |

R1's *in-scope* list is §1B; this table is its explicit complement. Sales/demo material and the pilot agreement must state these exclusions.

## 2. IN — Full MVP scope (P0; delivered across releases R1–R5)

| Area | MVP features | Explicitly *not* in MVP |
|---|---|---|
| Platform | Super Admin login (MFA-ready; TOTP if time), create/suspend school, owner invite, manual plan/limit assignment, platform audit view | analytics dashboards, billing automation, announcements, support tickets |
| Identity & security | email+password login, lockout, reset, invite, sessions, logout-all, audit log, RBAC with the 11 system roles (data-driven) | custom-role UI, MFA for schools, SSO |
| Tenancy | full isolation kernel + harness (non-negotiable) | per-school DB option, vanity subdomains |
| School setup | profile/logo, policies (working days, attendance, grading, fees), sessions, classes, sections, subjects, teacher assignments, holidays (simple) | shifts/period config, timetable |
| Users | invite staff, assign roles | bulk user import |
| Students | create/edit/search/filter, profile, photo, guardians & links, status lifecycle (withdraw/transfer), documents (upload/download), profile print, history | admission pipeline, medical (optional P1), alumni module |
| Import/export | CSV/XLSX import for students+guardians, classes, staff; mapping, preview, error report; CSV export of students | fee-balance import (needs rules, P1) |
| Staff | profile, assignment to classes/subjects, status | salary/payroll, leave, staff attendance |
| Promotion | end-of-year promote/retain/graduate, bulk, history preserved; session rollover | — |
| Attendance | daily class attendance (mobile), bulk save, corrections+approval, monthly & low-attendance reports, parent absent alert (email, consent-aware) | period-wise attendance, staff attendance |
| Fees | categories, structures, instalments, concessions with approval, invoice generation, **manual** collection (cash/UPI/bank/cheque), partial/advance, receipts (PDF), reversal/refund with approval, day-book & day-close, dues/overdue, collection reports, CSV export | online payments, auto late-fee (manual apply only), payment-gateway, GL/accounting export |
| Exams | grading scales, exams, subject max/pass marks, marks entry (absent/exempt), result compute/approve/publish, report card PDF (one template), correction history | rank/analytics beyond basics, multiple templates, internal-assessment weightings beyond configured components |
| Notices | school/class/section notices, in-app + email, read status | SMS/WhatsApp, event RSVP |
| Parent portal | read-only: children switcher, attendance, fee dues & receipts, results, notices | online payment, messaging/chat, homework/timetable (P1) |
| Teacher shell | today view, attendance, marks entry, class roster, notices | homework, leave |
| Reports | strength, attendance, collection, outstanding, results (real data, CSV) | XLSX/PDF for every report, scheduled reports |
| Ops | health checks, logging, backups + **restore drill**, deployment, monitoring | multi-region, autoscaling |
| Privacy | consent records (guardian), minimal data fields, retention doc, export of school data by request | self-serve DSR workflow UI |

## 3. P1 — within ~3 months after go-live (order by pilot feedback)
Student portal · Timetable · Homework · Admissions pipeline · Staff attendance & leave · Medical info · Custom roles UI · MFA for school staff · XLSX/PDF exports · Fee-balance import · Auto late-fee · Certificates (bonafide/TC) · Global search palette · Support tickets · Platform billing records · Data-request workflow.

## 4. P2/P3 — demand-driven
Online payments (Razorpay, per-school account), automated subscription billing, SMS/WhatsApp, ID cards, Library, Transport, Payroll, Inventory/assets, multi-branch, native apps.

## 5. MVP Definition of Done
1. All MVP acceptance criteria in doc 11 pass; isolation suites 1–14 green; 10 mandatory scenarios green.
2. Finance invariants (ledger = balances) hold under property & concurrency tests; **parallel-run reconciliation with the school's Excel matches for 30 days** (pilot success criterion).
3. Restore drill completed and recorded.
4. Security checklist (doc 06 threats T1–T27) reviewed; `npm audit` clean of high/critical; ZAP baseline run on staging.
5. Realistic-volume performance test passed.
6. Mobile (360 px) and keyboard-only checks passed on attendance, fee collection, parent portal.
7. **Production-Readiness Gate (doc 12 §10) passed in full — including legal review of privacy notice, ToS and school agreement by a qualified professional (your action) — before any real student data is loaded anywhere.**
8. Runbooks & admin/onboarding guides written.
9. No open P1 bugs; known limitations listed honestly in release notes.

## 6. Pilot plan (after R1 build is complete)

**Gate first:** no onboarding of real students until the Production-Readiness Gate (doc 12 §10) passes — including a funding path (D-26) and legal review. Until then the school can only see **demos on staging with synthetic data**.

Week −4 staging rehearsal with a *synthetic* file that mirrors the school's real column structure → Week −2 gate review and restore drill → Week 0 onboarding (setup, import, staff accounts, 2 training sessions) → Weeks 1–4 parallel-run with the paper/Excel register, daily comparison, feedback log → Week 5 go/no-go → Weeks 6–12 stabilise. For R2 (fees) the same pattern repeats with a **30-day cash/ledger parallel-run** and gate item G8.

**Calendar alignment:** Indian sessions start in April. Aim R1 go-live for the start of a session or after a mid-session import; schedule promotion/rollover (≈ 35 h) to be ready before the first year-end (§1C).

## 7. Effort and timeline (Revision 2 — 5–10 h/week)

### 7.1 Method and honesty notes
- Bottom-up estimate in **hours**, per phase, then converted to calendar time. Three scenarios:
  - **Optimistic (O):** AI-generated code mostly works first time; few misunderstandings; little rework.
  - **Expected (E):** typical rework, debugging and learning of unfamiliar areas (sessions, Mongo transactions, testing harness, deployment).
  - **Conservative (C):** significant rework in the kernel and finance, several blocking bugs/tool problems, interruptions.
- Hours include **everything**: building with AI, reading/understanding AI output, learning, debugging, tests, security review, documentation, deployment and restore drills (composition in 7.3). They do **not** include the pilot-school support period or the legal review lead time.
- **Calendar conversion:** `months ≈ hours ÷ (hours/week × 4)` (4 productive weeks per month ≈ 48 per year).
- **Planning baseline = 7.5 h/week** (midpoint); 5 and 10 are shown for sensitivity.
- **These are first-principles estimates with no velocity data.** They will be re-baselined with real numbers (7.5).

### 7.2 Hours by phase (doc 10 rev 3 numbering) — revised for the full critical-flow E2E scope

| Release | Phase | O | **E** | C |
|---|---|---|---|---|
| R1 | 1 Architecture finalisation (register CSV, ADRs, schema/OpenAPI skeleton) | 25 | **40** | 60 |
| R1 | 2 Foundation (monorepo, strict TS, lint rules incl. tenancy, env, logging, DB, CI, replica-set test infra incl. Playwright projects) | 40 | **70** | 110 |
| R1 | 3 Identity + tenancy + RBAC + audit kernel, isolation harness, sync email adapter, entitlement-lite, idempotency/sequences **+ E2E: login/session persistence, CSRF, tenant switching** | 88 | **140** | 225 |
| R1 | 4 School setup + CLI provisioning + users/roles screens | 40 | **60** | 95 |
| R1 | 5 Students/guardians/staff-basic + CSV/XLSX import/export | 60 | **95** | 150 |
| R1 | 6 Attendance (marking, edits, reports) **+ E2E: attendance submission, mobile workflows** | 53 | **75** | 125 |
| R1 | 7 Hardening, deploy, backups + restore drill, tenant export/purge/restore scripts, monitoring, gate evidence | 60 | **90** | 150 |
| | **R1 subtotal** | **366** | **570** | **915** |
| R2 | 8 Fees & ledger (+ receipts PDF incl. pdfmake spike, day-close, reports, finance suites) | 110 | **170** | 270 |
| R3 | 9 Job queue + notices + email notifications + parent portal | 65 | **100** | 160 |
| R4 | 10 Exams & report card | 80 | **120** | 190 |
| R5 | 11 Promotion/rollover + platform console + MFA (platform web) | 60 | **95** | 150 |
| | **Full MVP (R1–R5)** | **681** | **1,055** | **1,685** |

*What changed vs rev 2:* +20 h expected (O +16, C +40) for the E2E scope you required (Phase 3 +10, Phase 6 +10 expected). Option B was not selected, so no alternate totals are carried.

### 7.3 Where the R1 expected hours go (570 h)

| Activity | Share | Hours |
|---|---|---|
| Building with AI assistance | 35 % | ≈ 200 |
| Learning & understanding generated code (so you can maintain it) | 20 % | ≈ 114 |
| Debugging | 15 % | ≈ 86 |
| Writing/maintaining tests (unit, API, isolation, concurrency, E2E) | 15 % | ≈ 85 |
| Security review (threat-model checks, dependency/scan reviews) | 5 % | ≈ 28 |
| Docs, deployment, backup/restore drill | 10 % | ≈ 57 |

### 7.4 Calendar time (months), cumulative

| Scope | Hours/week | **Optimistic** | **Expected** | **Conservative** |
|---|---|---|---|---|
| **R1 (student management & attendance pilot)** | 5 | 18.3 | **28.5** | 45.8 |
| | **7.5** | 12.2 | **19.0** | 30.5 |
| | 10 | 9.2 | **14.3** | 22.9 |
| R1 + R2 (+ fee desk) | 5 | 23.8 | 37.0 | 59.3 |
| | **7.5** | 15.9 | **24.7** | 39.5 |
| | 10 | 11.9 | 18.5 | 29.6 |
| R1–R3 (+ parents & notices) | **7.5** | 18.0 | **28.0** | 44.8 |
| R1–R4 (+ exams) | **7.5** | 20.7 | **32.0** | 51.2 |
| **Full MVP (R1–R5)** | 5 | 34.1 | 52.8 | 84.3 |
| | **7.5** | 22.7 | **35.2** | 56.2 |
| | 10 | 17.0 | 26.4 | 42.1 |

**Reading this honestly:** at the 7.5 h/week baseline, R1 is ≈ **19 months expected** (≈ 12–31). The full MVP is ≈ **3 years expected** — not a sensible single target, which is why delivery is by release with checkpoints.

### 7.5 Checkpoints and what happens if velocity is lower
- **Re-baseline after Phase 2 and again after Phase 3.** I compare actual hours with the E column. If actual > **1.5 × E**, we stop and decide together: trim list below, or re-plan the release scope. If actual < E, nothing changes (no pressure to add scope).
- **R1 trim list** (if needed, ≈ −50 h): XLSX import → CSV only (−10) · audit-viewer UI → API only (−10) · low-attendance report (−8) · holidays UI → CLI-seeded (−6) · later-date attendance edit by admin only, no class-teacher flow (−8) · staff-basic → user accounts + assignments only (−10).
- **Release-level cut order** if time collapses: R5 console (use CLI longer) → R4 exams → R3 parent portal → R2 fees. **Never cut** the items in §1C "Never cut".
- Pause rule: if work stops for > 6 weeks, a documented "safe parking" state (CI green, docs current, nothing half-migrated) is maintained at the end of every phase, so a pause never leaves the repo broken.

### 7.6 Biggest uncertainties
Phase 3 (isolation kernel: new concepts, most security-critical) · Phase 8 (finance correctness) · Phase 7 (first real deployment/restore) · your learning curve on MongoDB transactions and testing infrastructure. These are why C is 1.6× E.
