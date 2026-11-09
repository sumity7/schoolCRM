# B. Module & Feature Inventory (requirements register seed)

**Single-source-of-truth rule.** Each module block lists purpose, roles, workflows, validations, edge cases, reports, notifications, dependencies and priority. The other required attributes live in one place each, to avoid contradictory copies:

| Attribute | Where |
|---|---|
| Permissions | [03-rbac-matrix.md](03-rbac-matrix.md) |
| Database entities | [05-data-dictionary.md](05-data-dictionary.md) |
| API endpoints | [07-api-spec.md](07-api-spec.md) |
| Screens | [08-frontend-routes.md](08-frontend-routes.md) |
| Acceptance tests | [11-testing-acceptance.md](11-testing-acceptance.md) |

**Priority:** P0 pilot-blocking · P1 pilot-soon (≤3 months after go-live) · P2 later · P3 future. **MVP** = P0 (+ a few P1 marked). Requirement IDs are `REQ-<CODE>-nnn`; ranges below are reserved, individual rows are created in Phase 1.

---

## Platform & foundation modules

### PLT — Platform / Super Admin (P0 minimal, P1 full) `REQ-PLT-001…060`
- **Purpose:** Vendor console to onboard/suspend schools, manage plans, view health, audit.
- **Roles:** Super Admin, Platform Support.
- **Workflows:** register-request → review → approve → provision tenant (+owner invite) → go-live; suspend/reactivate; break-glass support session (reason, time-boxed, read-only, audited).
- **Validations:** unique school code & official email; Super Admin MFA required; every platform action audited.
- **Edge cases:** owner email already exists in another school (one user, many memberships); suspend while payments in flight; deleting vs. deactivating (never hard-delete).
- **Reports:** schools by status, students/staff totals, plan usage, expiring subscriptions.
- **Notifications:** approval/suspension emails, expiry reminders.
- **Depends on:** AUTH, TEN, AUD. **MVP:** school list/create/suspend, audit viewer, manual subscription record.

### ONB — School onboarding wizard (P0) `REQ-ONB-001…030`
- **Purpose:** Take a new school from "approved" to "go-live" via a checklist.
- **Workflows:** 12 steps in spec §6; each step has a completion check; go-live approval by Super Admin.
- **Validations:** can't go live without session, ≥1 class/section, owner verified.
- **Edge cases:** partial completion/resume; wrong academic year; importing students before classes exist (blocked).
- **Depends on:** TEN, ACA, SET, IMP.

### TEN — Tenancy core (P0) `REQ-TEN-001…025`
- **Purpose:** Guarantee data isolation; resolve "which school am I acting for".
- **Rules:** tenant from session membership only; `schoolId` injected by repository layer; cross-reference validation; tenant-scoped uniques. Full design in [06](06-tenant-isolation-threat-model.md).
- **Tests:** per-route isolation harness (doc 11).

### AUTH — Authentication & sessions (P0) `REQ-AUTH-001…040`
- **Purpose:** Identity. One `User` (global) ↔ many `Memberships` (per school).
- **Decision:** server-side opaque session cookie (see doc 04 §6). Argon2id hashing.
- **Workflows:** login, logout, forgot/reset, change password, invite-accept, session list/revoke, lockout/throttle, email verification, optional TOTP MFA (P1; mandatory for platform staff).
- **Validations:** password policy (length ≥ 10, breach-list check P1), email normalisation, rate limits.
- **Edge cases:** invited user already registered; reset token reuse; concurrent sessions; deactivated membership mid-session.
- **Notifications:** verification, reset, new-login (P2).

### RBAC — Roles & permissions (P0) `REQ-RBAC-001…030`
- **Purpose:** Decide what a membership may do, *and over which records* (scope: `own | assigned | class | school`).
- **Design:** permission keys `resource:action`; system roles are data (seeded, immutable names), custom roles (P1 UI) are per-school documents. Checked by server middleware + service-level record-scope filter.
- **Edge cases:** user holds 2 roles (teacher + accountant) → union of permissions; permission removed mid-session takes effect on next request (no permission caching in token).

### AUD — Audit logging (P0) `REQ-AUD-001…020`
- **Purpose:** Tamper-evident record of who did what. Append-only collection; no update/delete API.
- **Captured:** actor, membership, school, action, entity, before/after (redacted), IP, UA, requestId. Reads of sensitive data (medical, salary, support break-glass) also logged.
- **Edge cases:** PII in diffs (field allow-list/redaction); log volume (TTL/archival policy — but never TTL for financial audit).

### FIL — Files & documents storage (P0 basic) `REQ-FIL-001…025`
- **Purpose:** Private storage for photos, documents, receipts.
- **Rules:** object key `schools/{schoolId}/{kind}/{uuid}`; metadata in `files` collection; download only via API ownership+permission check → short-lived signed URL (or streamed in dev); MIME sniffing + extension allow-list; size caps; AV scan hook (production strategy: ClamAV or provider scan — P1).
- **Edge cases:** orphaned files; rename; deleted student → retention rules; SVG/HTML uploads (blocked).

### NOT — Notifications (P0 in-app + email) `REQ-NOT-001…030`
- **Purpose:** Event → template → channel adapter → delivery record. Adapters: `InApp`, `Email`, (`Sms`, `WhatsApp` P2 stubs that honestly report "not configured").
- **Rules:** status only `queued/sent/failed/delivered(if provider confirms)`; never "delivered" without a provider callback; dedupe key; per-user preferences; consent flag per channel.
- **Edge cases:** retries with back-off; bounced emails; sibling parents (one notification, not two); quiet hours.

### JOB — Background jobs (P0) `REQ-JOB-001…010`
- **Purpose:** Imports, bulk PDFs, notifications, reminders. **Mongo-backed queue** (no Redis, zero budget) with lease/heartbeat, retries, idempotency; replaceable by BullMQ later.

### IMP — Import / export (P0 students, classes; P1 others) `REQ-IMP-001…030`
- **Workflow:** upload → parse → column map → validate (row-level) → preview with error report → confirm → background commit → import history → rollback (batch-tagged records, only if untouched since).
- **Validations:** duplicate detection (admission no., name+DOB+guardian phone), max rows/size, encoding (UTF-8/Excel), formula-injection sanitisation on export (`=`, `+`, `-`, `@` prefix).
- **Rule:** no row silently dropped — every row is committed, skipped-with-reason, or rejected-with-reason.

---

## School administration & academics

### SET — School settings & branding (P0 basic) `REQ-SET-001…030`
- Profile, logo, theme colour (from constrained palette), working days, timezone, date format, language, attendance/fee/grading policy containers, receipt/report-card branding.
- **Validations:** logo type/size; colour contrast check; settings schema-versioned.
- **Edge cases:** changing working days after attendance exists (applies prospectively).

### ACA — Academic structure (P0) `REQ-ACA-001…050`
- Sessions (one active), classes (grade levels), sections, subjects, class-subject mapping, class teacher, teacher-subject-class assignments, optional subjects, calendar & holidays, shifts/periods (P1), **session rollover**, promotion (promote/retain/transfer/graduate/change section/bulk).
- **Validations:** one active session per school; section capacity; dates non-overlapping.
- **Edge cases:** promotion keeps history (new `enrollment` per session; old rows immutable); rollover with unpaid dues (carry-forward invoice, see FEE); mid-session joiners.
- **Depends on:** TEN, SET.

### ADM — Admissions (P1; enquiry P0-lite) `REQ-ADM-001…040`
- Enquiry → application → review → approve/reject → register as student (creates Student + guardian links + enrolment + admission fee invoice).
- **Validations:** age-for-class rule (configurable), duplicate applicant detection, document checklist.
- **Edge cases:** approve without seat; applicant for next session; sibling discount.
- **Notifications:** status updates to guardian.

### STU — Student information (P0) `REQ-STU-001…070`
- Profile, photo, demographics, contact, guardians, emergency contacts, previous school, documents, medical (restricted), status lifecycle (`applicant → active → promoted/retained → transferred/withdrawn/graduated(alumni)`; re-admission), search/filter/export, print profile.
- **Validations:** unique `admissionNo` per school; DOB sane for class; phone/email formats; Aadhaar **not collected** by default (avoid; if a school insists → encrypted + restricted; decision D-13).
- **Edge cases:** siblings share guardians; name changes; transfer with unpaid dues; withdrawn student's receipts remain retrievable.
- **Soft delete only**; "delete" = `status: withdrawn/archived`; hard erasure only via governed erasure workflow.

### PAR — Parents & guardians (P0) `REQ-PAR-001…030`
- Guardian record separate from `User` login. Link `StudentGuardian{relationship, isPrimary, canPickup, canViewFees, verifiedAt, verifiedBy}`. Parent can access a child **only** if a verified, active link exists.
- **Edge cases:** divorced/separated guardians with restricted access; one phone shared by two guardians; parent with children in two schools (two memberships under one user).

### TCH — Teachers & staff (P0 basic, P1 full) `REQ-TCH-001…050`
- Profile, employee ID, designation, department, qualification, subject/class assignment, employment status & history, documents; salary data in restricted sub-resource (separate permission `staff.salary:read`).
- **Edge cases:** teacher leaves mid-session (reassign classes, keep history); one person both teacher and accountant.

### ATT — Attendance (P0 student daily; P1 staff) `REQ-ATT-001…050`
- Daily class attendance (present/absent/late/half-day/excused), bulk mark, correction request → approval, percentage, low-attendance alert, monthly reports.
- **Rules:** unique `(schoolId, sessionId, studentId, date)`; teacher limited to assigned class (or class teacher); no marking on non-working day/holiday unless override (audited); edits after N hours need approval (policy-configurable).
- **Edge cases:** student joins mid-month (days before enrolment not counted); double submit; timezone (date stored as `YYYY-MM-DD` in school timezone); sections merged for a day.
- **Notifications:** absent alert to guardian (consent-gated).

### TTB — Timetable (P1) `REQ-TTB-001…030`
- Periods, class/teacher/room timetables, substitutes, conflict detection (teacher/class/room), publish with revision history.

### HWK — Homework (P1) `REQ-HWK-001…030`
- Create, attach (file rules), due date, submissions, late flag, feedback, marks, parent visibility.

### CAL — Calendar (P1) — events, holidays; feeds ATT, TTB, portals.

---

## Finance

### FEE — Fees & accounting (P0) `REQ-FEE-001…120`
- **Config:** fee categories, structures per class/session, instalment plans with due dates, late-fee rule, discounts/scholarships/concessions (with approval limits), transport fee link (P1).
- **Billing:** generate invoices per student per session/instalment (idempotent; re-run doesn't duplicate).
- **Collection:** cash/UPI/bank/cheque (manual recording, P0); online gateway (P2). Partial/advance/multi-invoice allocation; receipt per payment, per-school sequential numbering.
- **Corrections:** cancel receipt / reverse payment / refund request→approve→pay; fee adjustment; all via new ledger entries, never edits.
- **Rules:** money as integer paise; immutable payments & ledger; idempotency key on every collection request; receipt number allocated in the same DB transaction as the payment; daily close (P1) locks a day's collections.
- **Validations:** cannot overpay unless "advance" flag; discount ≤ role limit else approval; cheque needs bank/no/date; payment date ≤ today unless backdate permission.
- **Edge cases:** double-click submit; two cashiers on same student; student withdrawn with dues; fee structure edited after invoices exist (versioned; applies only to new invoices); cheque bounce reversal; sibling discount.
- **Reports:** daily/monthly/annual collection, class-wise, category-wise, outstanding/overdue, refunds, discounts, cash-vs-online, **cashier day-book**.
- **Notifications:** receipt to guardian, due/overdue reminders (consent-gated).
- **Depends on:** STU, ACA, FIL (PDF), NOT, AUD. **Not claiming accounting compliance** (needs an accountant's spec).

### SUB — Platform subscription billing (P1 manual, P2 automated) `REQ-SUB-001…040`
- Plans, entitlements (limits + module flags), trials, renewals, grace, invoices, suspension; **expiry never deletes data** — access degrades to a read-only/export mode (policy configurable, decision D-10). Razorpay adapter only after lifecycle is tested.

### PAY — Payroll (P3) `REQ-PAY-001…040` — salary structure, periods, slips, approval; **no statutory (PF/ESI/TDS) calculations** without a verified rules engine and professional review.

### INV — Inventory & assets (P3) `REQ-INV-001…030` — items, stock movements (append-only), vendors, purchases, asset register, maintenance.

---

## Learning & results

### EXM — Exams & results (P0 core, P1 report cards) `REQ-EXM-001…080`
- Exam types/terms, schedules, per-subject max/pass marks, marks entry (absent/exempt/practical/internal), configurable grading scales & result formula, approval → publish → correction history, ranks (optional), report cards (PDF), analytics.
- **Rules:** results stored with the **grading-scale version** used; published results immutable (correct via versioned correction record); rounding rule configurable per school (half-up default; explicit); missing marks ≠ zero.
- **Edge cases:** optional subjects; failed-subject policy; re-exam; student promoted after exam; teacher enters marks for non-assigned subject (blocked).
- **Depends on:** ACA, STU, TCH.

### LIB — Library (P3) · TRN — Transport (P3) — see doc 05 for entities; library blocks issue when no available copy (atomic decrement); transport location data **not collected** in v1 (no GPS).

---

## Cross-cutting product modules

### NTC — Notices (P0 basic) `REQ-NTC-001…025`
- Audience targeting (school/class/section/role/individual), schedule, attachments, read receipts; channel via NOT.

### RPT — Reports (P0 core set) `REQ-RPT-001…040`
- Real-data only; filters (session, class, section, date); CSV (P0), XLSX/PDF (P1); export permission `reports:export` separately from view; every export audited; **CSV formula-injection sanitised**.

### DOC — Certificates & generated documents (P2; bonafide/receipt P0–P1) `REQ-DOC-001…030`
- Templates with placeholders; generated PDF stored with unique doc id and verification code; history retained.

### SRCH — Search (P0 simple, P1 global) `REQ-SRCH-001…015`
- Per-resource indexed search (prefix on name/admissionNo/phone). Always tenant + permission scoped. **No cross-tenant index ever**; if Atlas Search is adopted later, index filters on `schoolId`.

### PRT — Portals: Parent (P0 read-only), Student (P1), Teacher (P0 via role-aware school app) `REQ-PRT-001…040`
- Data shown only through guardian/student link checks; parent fees visible only if `canViewFees`.

### SUP — Support tickets (P1) `REQ-SUP-001…020` — school ↔ vendor tickets; support staff sees ticket + explicitly shared context only.

### PRV — Privacy & compliance (P0 foundations) `REQ-PRV-001…030`
- Consent records (guardian consent for notifications & portal), retention schedule, data-export for a school, correction & erasure request workflow (with legal-hold carve-outs), breach runbook, privacy notice templates.

### OPS — Backup, DR, monitoring (P0 plan, P1 tested) `REQ-OPS-001…025`
- Backup schedule, encrypted off-site copy, **restore drill before go-live**, health checks, error tracking, uptime monitor, runbook.

---

## Summary counts
~35 modules · ≈1,400 requirement IDs reserved (not all will exist) · **MVP touches 16 modules, lightly in 6 of them** (see doc 15).

---
**Board-neutral rule (D-01, rev 3):** class levels, subjects, terms, grading, fee heads and report-card layout are configuration, not code; pilot-school validation checkpoints are in [14 §G](14-missing-and-decisions.md). **R1 scope** is the Student Management & Attendance Pilot (doc 15 §1B); modules above marked R2–R5 are not part of it.
