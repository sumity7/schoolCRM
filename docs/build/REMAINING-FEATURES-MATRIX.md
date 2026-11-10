# Remaining Features Matrix (audit of R1–R5 against the "remaining features" directive)

Audit date: 2026-11-10. Method: read the repository (modules, routes, screens, tests, docs/build). Status vocabulary:
**V** = implemented & verified (tests ran) · **P** = implemented but incomplete · **N** = not implemented · **EXT** = blocked by external credentials · **PAID** = blocked by paid infrastructure · **LEGAL** = needs a legal/business decision.
This table is the starting point; REMAINING-FEATURES-PROGRESS.md records what changes.

| § | Feature | Status at audit | Notes |
|---|---|---|---|
| 3 | Student login, sessions, password change | **P** | Identity/sessions/CSRF/password change exist (R1). No student accounts: `student` role template exists (own-scope grants) but nothing creates or activates a student login. |
| 3 | Student password reset / activation / deactivation | **N** | Parent/staff invitations exist; students need a staff-issued one-time activation (no e-mail assumed). |
| 3 | Student dashboard, attendance, results, report cards | **N** | Parent equivalents exist (`/parent/children/*`); student routes do not. |
| 3 | Student documents (ID card, certificates) | **N** | Depends on §15. |
| 4 | Parent portal: multi-child, attendance, fees, receipts, results, report cards, notices | **V** | R3/R4, E2E-10/11. |
| 4 | Parent: calendar view, homework, timetable, documents, profile, notification preferences, access policies | **N** | |
| 5 | Timetable | **N** | |
| 6 | Homework & assignments (+ file uploads) | **N** | No file storage service exists yet (FileService interface only in docs). |
| 7 | Admissions (enquiry → application → approval → student) | **N** | Students CRUD, CSV import and guardians exist and are reused. |
| 8 | Library | **N** | |
| 9 | Transport | **N** | Fee categories include a `transport` kind; no routes/vehicles. |
| 10 | SMS / WhatsApp architecture | **N** | Email adapter port exists (dev outbox only). Live sending: **EXT**. |
| 11 | Platform billing (plans, subscriptions, invoices, entitlements) | **P** | Per-school `limits.students/staff` enforced (R1). No plans, subscriptions, invoices. Gateway: **EXT**. GST claims: **LEGAL**. |
| 12 | 2FA recovery codes / recovery workflow | **P** | TOTP + MFA-pending sessions exist (R5); no recovery codes. |
| 13 | Support-staff emergency access | **P** | `readOnly` TenantContext flag and `supportGrantId` on sessions exist as design hooks; no workflow. |
| 14 | Academic calendar | **P** | Holidays/events API + screen (R1). No calendar view, class-specific events, reminders. |
| 15 | Certificates & documents | **P** | Fee receipt and report-card PDFs exist (pdfmake + Hindi fonts, R2/R4). No certificate templates, numbering, verification, download history. |
| 16 | Notification center | **P** | Notices with read receipts exist (R3). No unified in-app notification feed, preferences, delivery history. |
| 17 | Advanced reporting | **P** | Attendance monthly/low, fee collection/outstanding + CSV exist. No academic/administration/platform analytics, charts. |
| 18 | Global search | **P** | Student search exists. No cross-entity search. |
| 19 | Inventory | **N** | |
| 20 | UI/UX finishing | **P** | 25-screen sweep, responsive checks exist. No toasts, no keyboard/a11y audit, no print layouts. |
| 21 | Security & privacy review | **P** | SECURITY-REPORT.md pass 1; isolation harness covers all routes. New modules must extend it. |
| 22 | Background workers | **P** | Mongo job queue (lease, backoff, dead-letter, de-dup) exists (R3). Needs more job types, graceful shutdown, concurrency tests. |
| 24 | Performance on large synthetic data | **P** | R1/R2 perf run exists (333k attendance). New modules need runs. |
| 25 | `dev:check` / `dev:all` / `dev:stop` | **N** | Only `dev:db`, `dev:api`, `dev:web`. |
| 26 | Production readiness docs | **P** | DEPLOYMENT.md, BACKUP-RESTORE.md, SECURITY-REPORT.md exist. Incident response, migrations, runbooks missing. |

## External blockers (cannot be completed in this environment)
Live SMS/WhatsApp/email delivery (credentials), payment gateway (credentials + authorisation), real hosting/domain/TLS, independent security audit, legal review (DPDP, GST, certificate wording), pilot school authorisation.

## Design constraints carried into this phase
No commits/pushes/deploys; `apps/api/.data/mongo-dev` is never deleted or reset; synthetic data only; no live integrations; every module needs model + API + UI + authorization + validation + audit + tests + browser journey + docs before it counts as complete.

## Status updates (since audit)
| § | Feature | Status now | Evidence |
|---|---|---|---|
| 3 | Student login, sessions, password change | **V** | student-portal.test.ts, isolation harness, E2E-13 student card journey |
| 3 | Student activation / deactivation / reissue | **V** | student-portal.test.ts |
| 3 | Student dashboard, attendance, results, report cards | **V (API+UI); browser journey covered only via demo-login E2E** | `/student/*`, `/app/me`; dedicated activation-flow E2E still open |
| — | Login-page demo accounts (dev only) | **V** | demo-login.test.ts 5/5, e2e/demo-login.spec.ts 11/11 ×2 projects, `check:bundle` |
