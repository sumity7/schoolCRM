# EduNex — Product Audit & Gap Analysis

**Date:** 2026-11-10. **Basis:** the repository itself (API route manifest, web pages, models, tests), not earlier reports.
**Scope target:** basic Indian school, Nursery/KG – Class 7, operable by non-technical staff.

Status legend (as requested):
**PASS** implemented and verified by tests run on 2026-11-10 · **PARTIAL** implemented, not fully verified or not complete ·
**MISSING** not implemented · **BLOCKED** needs external credentials / approval / infrastructure · **FAILED** tested and not working.

## 0. What exists today (inventory)

- **API:** 199 routes in 23 modules — academics 12, attendance 11, audit 1, auth 16, classes 4, exams 15, fees 41, homework 8,
  imports 9, notices 5, parent 10, platform 5, promotions 3, results 1, roles 1, schools 5, sections 4, staff 5, student 11,
  students 14, subjects 3, timetable 12, users 3.
- **Web:** 39 pages (auth 5, school app 32, platform 2).
- **Architecture:** Express + MongoDB (tenant-scoped repositories that fail closed without a tenant context), Next.js 15 web,
  server-side sessions, CSRF (JSON + header + Origin), Argon2, deny-by-default RBAC with per-school role templates,
  Mongo-backed job queue, pdfmake PDFs.
- **Verification on 2026-11-10:** API suite **212/212 PASS**; targeted browser specs on a production build **10/10 PASS**.
  The last *full* browser run (before the latest fixes) was 58/66 with 8 failures, all diagnosed (machine standby, a
  dev-server recompile caused by editing during the run, one real mobile layout bug and one test race — both fixed).
  **A full browser re-run after the latest UI changes has not happened yet** — every browser-level claim below is limited by that.
- **Deployment:** the repo contains a single-server setup (Caddy + systemd, `deploy/`, `docs/build/DEPLOYMENT.md`).
  **There is no Vercel or Render configuration in the repository**, contrary to the brief's assumption.

## 1. Module status

| Module | Status | Evidence / gap |
|---|---|---|
| A. School setup (profile, sessions, classes, sections, subjects, working days, holidays/events, grading) | PASS | API + E2E-08. Classes are data (Nursery–Class 7 or anything else). Gaps: school timings/shifts not modelled (timetable periods cover bell times); branding = name only; no multi-branch (each branch would be a separate school/tenant). |
| B. Admissions & enquiries | **MISSING** | Permission keys exist (`admissions:*`) but there is no model, route or screen. Students are registered directly (or imported). |
| C. Student information | PASS (core) / PARTIAL | Profiles, guardians, siblings (shared guardian), emergency contacts, status changes, promotion, history, search, bulk import with validation + undo, CSV export — tested. **Missing:** student photo, document management (keys `students.documents:*` exist, no implementation), previous-school record fields. |
| D. Parent portal | PARTIAL | PASS: linked children only (verified link + portal access, re-checked every request), child switcher, attendance + calendar, results + report-card PDF, fees + receipts (if allowed), notices with read state, timetable, homework, profile, school contact. **Missing:** exam schedule view, holiday/event calendar view, leave applications, self-service contact updates, notifications inbox. |
| E. Student portal | PARTIAL | PASS: activation by single-use link, own record only, attendance, results, fees (policy), notices, timetable, homework with submission. **Missing:** age tiers — Nursery–Class 2 should be parent-managed / read-only; today every student account gets the same portal. No messaging exists (correct). |
| F. Staff & teachers | PARTIAL | Staff records, status (incl. on_leave), subject + class-teacher assignments, login linking, teacher dashboard. **Missing:** staff attendance, leave applications/approval, workload overview, staff directory screen beyond the list. Payroll intentionally out of scope (salary keys reserved). |
| G. Attendance | PASS | Mobile-first marking, statuses, no duplicates (unique index, concurrency tested), edit window, correction workflow with audit, policy-based %, monthly + low-attendance reports, CSV. **Missing:** absence notifications to parents; teacher (staff) attendance. |
| H. Timetable | PASS (API) / PARTIAL (UI) | 9/9 API tests: versions, publish/archive history, teacher/room/class clashes refused by unique indexes incl. concurrency, availability, all views, tenant isolation. Browser spec written, **not yet run**. |
| I. Homework | PASS (API) / PARTIAL (UI) | 8/8 API tests incl. upload policy (magic bytes, extension, size, traversal), per-file authorisation, late/duplicate submissions, review, cross-tenant. Browser spec written, **not yet run**. Notifications for new homework missing. |
| J. Exams & results | PASS | Grading scales, exams, subjects with max/pass marks and optional date, marks entry by assigned teacher, lock, compute, publish, corrections, report-card PDF, promotion — API + E2E-11. **Missing:** exam schedule shown to parents/students (dates exist in the data). |
| K. Fees | PASS | Structures, instalments, invoices, partial payments, advance credit, concessions with approval, refunds, reversals, late fees, receipts PDF, day-close, collection/outstanding reports — API + E2E-09. Online payments **BLOCKED** (flag off, no gateway, never marks paid on request). Transport fees: only as a generic fee category. |
| L. Library | **MISSING** | Keys `library:*` and a librarian role template exist; no implementation. |
| M. Transport | **MISSING** | Keys `transport:*` and a transport-manager role exist; no implementation. GPS intentionally not planned. |
| N. Notices & notifications | PARTIAL | Notices with audiences (everyone/staff/parents/sections), read receipts, idempotent e-mail job (dev outbox only). **Missing:** in-app notification centre, preferences, attendance/fee/homework/exam alerts. SMS/WhatsApp **BLOCKED** (flags off, no provider). Real e-mail delivery **BLOCKED** (no provider configured). |
| O. Events & calendar | PARTIAL | Holidays, events, exams, PTMs stored and used by attendance. **Missing:** calendar view for parents/students/teachers. |
| P. Inventory & assets | **MISSING** | Keys exist, nothing else. |
| Q. Certificates & documents | PARTIAL | Receipts and report cards PDF — PASS. Bonafide/TC/character certificates, ID cards, templates — **MISSING**. |
| R. Admin & Super Admin | PASS / PARTIAL | Users & roles, audit log, school settings, Super Admin console with mandatory TOTP, school creation, suspension via status patch, platform audit — tested. **Missing:** 2FA recovery codes, system-health page, data export per school, job monitoring UI. Backup scripts exist (BACKUP-RESTORE.md); a restore drill is not verified. |
| SaaS billing & entitlements | PARTIAL | Plan limits (students/staff) are enforced and shown; trials, subscriptions, billing history — **MISSING** (no paid integration will be added without approval). |

## 2. Dashboards by role

| Role | Status | Notes |
|---|---|---|
| Super Admin | PASS | Real counts, schools, audit; MFA mandatory. No system-health widget. |
| School admin / principal | PARTIAL | Students, attendance today, fees, sections. Missing: upcoming exams, pending admissions (module missing), alerts. |
| Teacher | PARTIAL | Assigned classes + attendance. Missing on dashboard: today's timetable and pending homework reviews (both now exist as pages). |
| Accountant | PASS | Finance dashboard: collection, dues. |
| Librarian / transport | MISSING | Modules missing. |
| Parent | PASS | One card per child; child page tabs cover attendance, results, fees, timetable, homework, profile. |
| Student | PASS | Own overview; timetable/homework via menu. |

## 3. UX, accessibility, localisation

- PASS (E2E-verified on 360 px and desktop): no horizontal scroll on audited screens, ≥44 px tap targets, mobile menu,
  loading/empty/error states on the screens built so far, printable timetable, receipts and report cards.
- Found and fixed this session: six parent-child tabs overlapped at 360 px (now a scrollable tab bar).
- PARTIAL: UI strings are hard-coded English inside components — Hindi needs a string-extraction pass (no i18n layer yet).
- Not audited with tooling yet: colour contrast and keyboard-only navigation of every screen (a manual/axe pass is pending).

## 4. Child safety, privacy & security

Verified by tests (PASS): tenant isolation harness over **every** id-bearing and collection route (two schools, byte-for-byte
unchanged data); parent sees only verified, portal-enabled, unended links (404 for anything else); students reach only their own
record (no ids in URLs); deny-by-default RBAC with an explicit allow-list for own-scope routes; CSRF incl. a cross-origin
attacker page; Argon2; account lockout; secure cookie flags in production; audit log without secrets; upload restrictions;
demo credentials absent from production bundles.

Fixed this session:
- **P0 — credentials in URL:** a login submitted before the page hydrated fell back to a native GET, putting the password in
  the URL. Now: `method="post"`, button disabled until hydrated, middleware answers stray POSTs with 303 — regression test E2E-18.
- Student activation could set a password before validating the invitation; now validated first, and students cannot rename themselves.

Open items:
- 2FA recovery codes missing (lost device = admin-assisted reset only).
- DPDP Act 2023 and its Rules (children's data: verifiable parental consent, purpose limitation, retention, breach notification)
  — **requires qualified legal review; no compliance is claimed.** Product hooks still missing: consent records, data export /
  erasure requests, retention policy.
- Independent penetration test not performed.

## 5. Database & architecture

PASS: every school-owned collection carries `schoolId`; repositories refuse unscoped queries; unique indexes enforce the
business rules that matter under concurrency (attendance per student/day, one submission per homework, timetable clashes,
receipt numbers, one active session, one published timetable); pagination on list routes; append-only audit; soft delete
where history matters; transactions on money paths; idempotency keys on payments.
PARTIAL: no formal migration framework — schema changes so far are additive with defaults (safe); `sync-roles` handles
permission additions. Indexes in production are applied by a deploy step (`npm run cli -- sync-indexes`).

## 6. Priority backlog (what to build next, in order)

**P0** — none open from the code audit; full browser regression after the latest changes must still be run (verification debt).
**P1**
1. Parent/student **exam schedule** and **school calendar** views (data already exists).
2. **Leave applications** from parents (child absence) with class-teacher approval.
3. **Early-primary tier**: Nursery–Class 2 handled through the parent portal (no direct student login unless the school opts in).
4. **In-app notification centre** (homework, notices, attendance alerts, fee reminders) — reuse the job queue; SMS/WhatsApp stay disabled adapters.
5. **Staff attendance + leave**.
**P2** — admissions & enquiries; certificates (bonafide/TC/character) + ID cards; library; transport; inventory; student photo/documents.
**P3** — analytics, GPS, payroll, online learning, paid billing.

## 7. Required external setup (BLOCKED until you decide/approve)

| Item | Needed for |
|---|---|
| Hosting (a server, or the free options discussed) + domain | any public deployment |
| E-mail provider (e.g. SMTP / transactional e-mail) | invitations, password reset, notices by e-mail |
| SMS / WhatsApp provider | optional alerts (flags off) |
| Payment gateway | online fee payment (flag off) |
| Production `MFA_ENCRYPTION_KEY`, `COOKIE_SECURE=true`, real `APP_BASE_URL`/`ALLOWED_ORIGINS` | production start (enforced by the env guards) |
| Off-site backup target + restore drill | data-loss protection |
| Legal/privacy review (DPDP) | handling real children's data |
