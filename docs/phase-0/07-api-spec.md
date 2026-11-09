# G. API Endpoint Specification

**Scope of this document:** the full endpoint **catalogue** with auth, permission, tenant scope and key rules. Per-endpoint request/response bodies are defined once, as Zod schemas in `packages/shared`, and emitted as an OpenAPI 3.1 document (`/api/v1/openapi.json`, rendered at `/docs` in non-prod) — written per module in its phase so docs never drift from code. This avoids ~300 hand-written schemas going stale.

## 0. Global conventions

| Topic | Rule |
|---|---|
| Base | `/api/v1`. Breaking changes → `/v2`. |
| Auth | Session cookie (`__Host-edunex_sid`). `public` routes are explicit. Webhooks use signature, not cookie. |
| Tenant | Derived from session. **No `schoolId` in school-scoped URLs/bodies.** Platform routes under `/platform/*` carry explicit school ids and require platform role. |
| Gates (order) | authn → tenant/membership → entitlement → permission(+scope) → validation. |
| Format | JSON, UTF-8. IDs as 24-hex strings. Money = integer paise. Calendar days `YYYY-MM-DD`. Instants ISO-8601 UTC. |
| Pagination | `?page=1&limit=25` (max 100) → `{data:[…], meta:{page,limit,total,totalPages}}`. High-volume lists (audit, ledger) use cursor: `?cursor=&limit=` → `{data, meta:{nextCursor}}`. |
| Sorting/filtering | `?sort=field:asc` and filters from an **allow-list per endpoint**; unknown params → 400. |
| Errors | `{ "error": { "code": "VALIDATION_FAILED", "message": "…", "details":[{path,message}], "requestId": "…" } }`. Codes: `UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, CONFLICT 409 (version/duplicate), VALIDATION_FAILED 422/400, RATE_LIMITED 429, ENTITLEMENT_REQUIRED 402/403, IDEMPOTENCY_MISMATCH 422, INTERNAL 500`. |
| Idempotency | `Idempotency-Key` header **required** on: payments, refunds, invoice generation, imports commit, promotion batches. |
| Concurrency | `If-Match: <__v>` or body `version` on edits of shared records → 409 on stale. |
| Rate limits | Classes: `auth` 5/min/IP+account (+lockout) · `sensitive` 20/min · `write` 120/min/user · `read` 300/min/user · `export` 5/hour/user · `webhook` provider-IP + signature. Tunable. |
| Response shaping | Explicit DTO allow-lists; hashes, tokens, internal flags never serialised. |
| Audit | ✎ = audited write; 👁 = audited sensitive read. |
| Soft delete | `DELETE` on soft-delete resources sets `deletedAt`; financial/academic "delete" = `POST …/void|reverse|archive`. |

Permission column uses keys from doc 03. Scope: `S` = school-tenant, `P` = platform, `—` = none.

---

## 1. `/auth` (scope —)

| Method | Path | Auth | Permission | Notes / rules |
|---|---|---|---|---|
| POST | `/auth/login` | public | — | `identifier` (email in R1; phone-capable, D-03 deferred) + password → session cookie; returns memberships list; `auth` rate class; generic errors; lockout |
| POST | `/auth/logout` | session | — | revokes current session ✎ |
| POST | `/auth/logout-all` | session | — | revokes all sessions ✎ |
| GET | `/auth/me` | session | — | user, active membership, effective permissions (for UI hints only) |
| POST | `/auth/switch-school` | session | — | body `{membershipId}`; verifies membership ✎ |
| POST | `/auth/forgot-password` | public | — | always 202; email token; `auth` class |
| POST | `/auth/reset-password` | public (token) | — | single-use token; revokes all sessions ✎ |
| POST | `/auth/change-password` | session | — | requires current password ✎ |
| POST | `/auth/verify-email` | public (token) | — | |
| POST | `/auth/accept-invite` | public (token) | — | set password, activate membership ✎ |
| GET | `/auth/sessions` · DELETE `/auth/sessions/:id` | session | — | own sessions only |
| POST | `/auth/mfa/enroll` · `/mfa/verify` · `/mfa/disable` | session | — | P1; mandatory for platform roles |

## 2. `/platform` (scope P — Super Admin / Support)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/platform/overview` | `platform.analytics:read` | aggregate counts only |
| GET/POST | `/platform/schools` | `platform.schools:read/create` | list (filters: status, plan, search); create ✎ |
| GET/PATCH | `/platform/schools/:id` | `platform.schools:read/update` | metadata only ✎ |
| POST | `/platform/schools/:id/approve\|suspend\|reactivate\|deactivate\|go-live` | `platform.schools:manage` | reason required ✎ |
| POST | `/platform/schools/:id/owner-invite` | `platform.schools:manage` | ✎ |
| POST | `/platform/support-grants` | `platform.support:grant` | break-glass ✎ (see doc 06 §4) |
| DELETE | `/platform/support-grants/:id` | same | revoke ✎ |
| GET/POST/PATCH | `/platform/plans[/:id]` | `platform.plans:*` | ✎ |
| GET/POST/PATCH | `/platform/subscriptions[/:id]` | `platform.subscriptions:*` | manual in MVP ✎ |
| GET | `/platform/invoices`, `/platform/payments` | `platform.billing:read` | P1+ |
| GET | `/platform/audit-logs` | `platform.audit:read` | cursor |
| GET/POST/PATCH | `/platform/admins[/:id]` | `platform.admins:manage` | ✎ |
| GET/POST | `/platform/announcements` | `platform.announcements:*` | |
| GET | `/platform/health`, `/platform/jobs` | `platform.health:read` | queue depth, failures |
| GET | `/platform/support/tickets[/:id]`, POST `/…/messages` | `platform.support:*` | assigned only for Support role |
| GET | `/health/live`, `/health/ready` | public | no data |

## 3. `/schools` — own-school profile & settings (scope S)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/schools/me` | any member | profile (own) |
| PATCH | `/schools/me` | `school.settings:update` | name/contact/branding ✎ |
| GET/PATCH | `/schools/me/settings` | `school.settings:read/update` | working days, policies; schema-validated; ✎ |
| POST | `/schools/me/logo` | `school.settings:update` | file rules |
| GET | `/schools/me/onboarding` · POST `/schools/me/onboarding/:step/complete` | `school.settings:update` | checklist |
| GET | `/schools/me/entitlements` | any member | plan limits/features & usage (real counts) |

## 4. `/users`, `/roles` (scope S)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/users` | `users:read` | school members (memberships joined) |
| POST | `/users/invite` | `users:create` | email, roleIds, person link; enforces role-grant subset rule; staff-limit entitlement ✎ |
| PATCH | `/users/:membershipId` | `users:update` | roles/status; last-owner protected ✎ |
| POST | `/users/:membershipId/suspend\|reactivate\|resend-invite` | `users:update` | ✎ |
| GET | `/roles` · `/roles/:id` | `roles:manage` or `users:read` | |
| POST/PATCH/DELETE | `/roles[/:id]` | `roles:manage` | custom roles only (P1); cannot exceed own perms ✎ |
| GET | `/permissions/catalog` | `roles:manage` | list of keys |

## 5. Academics: `/academics`, `/classes`, `/subjects`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET/POST | `/academics/sessions` | `academics:read/create` | ✎ |
| PATCH | `/academics/sessions/:id` | `academics:update` | dates; ✎ |
| POST | `/academics/sessions/:id/activate\|close` | `academics:approve` | one active; ✎ |
| POST | `/academics/sessions/:id/rollover` | `academics:approve` | copy classes/sections/structures to new session; idempotent ✎ |
| GET/POST/PATCH/DELETE | `/classes[/:id]` | `academics:*` | soft delete blocked if enrollments exist |
| GET/POST/PATCH/DELETE | `/classes/:classId/sections[/:id]` | `academics:*` | |
| GET/POST/PATCH/DELETE | `/subjects[/:id]` | `academics:*` | |
| PUT | `/classes/:classId/subjects` | `academics:update` | class-subject mapping ✎ |
| GET/PUT | `/academics/teacher-assignments` | `academics:read/update` | ✎ |
| GET | `/academics/sections/:id/roster` | `students:read` (scoped) | enrollment-based class list |
| GET/POST/PATCH/DELETE | `/academics/calendar/events[/:id]` | `academics:*` | holidays/events |
| POST | `/academics/promotions/preview` | `academics:approve` | dry run, returns per-student outcome |
| POST | `/academics/promotions/commit` | `academics:approve` | **Idempotency-Key**; chunked transaction; creates new enrollments, closes old ✎ |

## 6. `/students`, `/parents`, `/admissions` (scope S)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/students` | `students:read` (scoped) | filters: sessionId, classId, sectionId, status, q; teachers → assigned only; parents → linked only (separate `/parent/*`) |
| POST | `/students` | `students:create` | creates student (+optional guardians, enrollment); student-limit entitlement; unique admissionNo ✎ |
| GET | `/students/:id` | `students:read` | scope enforced; field-level DTO by role |
| PATCH | `/students/:id` | `students:update` | version check ✎ |
| POST | `/students/:id/status` | `students:update` | transfer/withdraw/readmit/graduate; reason; blocks if policy requires dues clearance (configurable) ✎ |
| GET | `/students/:id/medical` | `students.medical:read` | 👁 |
| PUT | `/students/:id/medical` | `students.medical:update` | ✎ |
| GET/POST | `/students/:id/documents` · DELETE `/students/:id/documents/:fileId` | `students.documents:*` | file rules; 👁 |
| GET/PUT | `/students/:id/guardians` | `guardians:*` | link/unlink, flags ✎ |
| GET | `/students/:id/history` | `students:read` | enrollments/promotions |
| GET | `/students/:id/profile.pdf` | `students:print` | print layout |
| GET | `/students/export` | `students:export` | job → file; audited, formula-safe 👁 |
| GET | `/students/search` | `students:read` | prefix search; capped results |
| POST/GET | `/imports` … see §20 | | |
| GET/POST/PATCH | `/parents[/:id]` (guardians) | `guardians:*` | |
| POST | `/parents/:id/invite` | `guardians:update` | creates login invitation only if verified link + consent ✎ |
| GET/POST/PATCH | `/admissions/enquiries[/:id]` | `admissions:*` | P1 |
| GET/POST/PATCH | `/admissions/applications[/:id]` | `admissions:*` | |
| POST | `/admissions/applications/:id/review\|approve\|reject\|waitlist` | `admissions:approve` | ✎ |
| POST | `/admissions/applications/:id/enroll` | `students:create` | registers Student + links + enrollment + admission-fee invoice; atomic ✎ |

**Parent/Student portal read APIs** (scope S, role-gated, always link-resolved):
`GET /parent/children` · `GET /parent/children/:studentId/{overview,attendance,fees,payments,results,timetable,homework}` · `GET /student/me/{overview,attendance,timetable,homework,results}`. Each verifies the verified-link (parent) or self (student) in the service; `:studentId` outside linked set → 404.

## 7. `/teachers`, `/staff`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET/POST | `/staff` | `staff:read/create` | ✎ |
| GET/PATCH | `/staff/:id` | `staff:read/update` | salary fields excluded unless permitted |
| POST | `/staff/:id/status` | `staff:update` | resign/terminate; reassign classes prompt ✎ |
| GET/PUT | `/staff/:id/compensation` | `staff.salary:read/update` | 👁 ✎ append-only |
| GET/POST/DELETE | `/staff/:id/documents` | `staff:update` | |
| GET | `/teachers` (alias filter `kind=teaching`) · GET `/teachers/me/classes` | `staff:read` / self | assigned classes/subjects |
| GET/POST | `/staff/attendance` · `/staff/leave-requests` | P1 | |

## 8. `/attendance`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/attendance/sections/:sectionId?date=` | `attendance:read` (scoped) | roster + existing marks |
| PUT | `/attendance/sections/:sectionId` | `attendance:create` (scoped) | body `{date, entries:[{studentId,status,remark?}]}`; bulk upsert; rejects non-working day, future date, students not enrolled, non-assigned section ✎ |
| POST | `/attendance/corrections` | `attendance:update` | request ✎ |
| POST | `/attendance/corrections/:id/approve\|reject` | `attendance:approve` | applies + audit before/after ✎ |
| GET | `/attendance/students/:studentId?from=&to=` | `attendance:read` | history + % |
| GET | `/attendance/reports/{daily,monthly,low-attendance}` | `attendance:read`/`reports:read` | |
| GET/PUT | `/attendance/policy` | `school.settings:update` | via settings |

## 9. `/fees`, `/payments` (finance — all `financial:view` gated)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET/POST/PATCH | `/fees/categories[/:id]` | `fees.config:*` | ✎ |
| GET/POST | `/fees/structures` · PATCH `/…/:id` (draft only) | `fees.config:*` | ✎ |
| POST | `/fees/structures/:id/publish` | `fees.config:approve` | immutable after; ✎ |
| POST | `/fees/concessions` | `discounts:apply` | > limit → `status: pending_approval`; ✎ |
| POST | `/fees/concessions/:id/approve` | `discounts:approve` | not self-approvable ✎ |
| POST | `/fees/invoices/generate` | `invoices:create` | **Idempotency-Key**; body `{sessionId, classId?/sectionId?/studentIds?, installmentLabel}`; unique key prevents duplicates; returns summary ✎ |
| GET | `/fees/invoices` | `invoices:read` | filters status/class/due/overdue/student |
| GET | `/fees/invoices/:id` | `invoices:read` | + allocations & ledger |
| POST | `/fees/invoices/:id/void` | `invoices:create` + approval rule | only if no payments; ✎ |
| GET | `/fees/students/:studentId/summary` | `invoices:read` | dues, advance, history from ledger |
| POST | `/payments` | `payments:create` | **Idempotency-Key** required. Body `{studentId, amountPaise, mode, paidOn, reference?, allocations?:[{invoiceId,amountPaise}]}`; auto-allocate oldest-due-first if omitted; one DB transaction: payment + allocations + ledger + receipt number; overpay → advance only if flagged ✎ |
| GET | `/payments` · `/payments/:id` | `payments:read` | |
| POST | `/payments/:id/reverse` | `refunds:request` → approve `refunds:approve` | creates reversal entries, cancels receipt; reason; ✎ |
| GET | `/payments/:id/receipt` (JSON) · `/receipts/:id.pdf` | `payments:print` | PDF; tenant+perm; parent via `/parent/…` |
| POST | `/refunds` · POST `/refunds/:id/approve\|reject\|mark-paid` | `refunds:request/approve` | separation of duties ✎ |
| POST | `/fees/adjustments` | `fees.config:approve` | ledger `adjustment`, reason mandatory ✎ |
| POST | `/fees/day-closings` · GET | `payments:create`+`financial:view` | lock day ✎ |
| POST | `/payments/online/orders` (P2) | parent/accountant | server creates gateway order with server-side amount |
| POST | `/webhooks/razorpay` (P2) | **signature**, `webhook` class | verify HMAC on raw body; unique `(provider,eventId)`; idempotent processing; never trust browser success |
| GET | `/fees/reports/{daily,monthly,annual,class-wise,category-wise,outstanding,refunds,discounts,mode-summary,cashier-daybook}` | `reports:read` + `financial:view` | export via `/reports/export` |

## 10. `/exams`, `/results`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET/POST/PATCH | `/exams/grading-scales[/:id]` · POST `/…/:id/publish` | `exams:*`/approve | versioned |
| GET/POST/PATCH | `/exams[/:id]` | `exams:*` | |
| PUT | `/exams/:id/subjects` | `exams:update` | max/pass marks, schedule |
| POST | `/exams/:id/open-marks\|lock-marks` | `exams:approve` | ✎ |
| GET | `/exams/:id/marks?sectionId&subjectId` | `marks:read` (scoped) | teacher only for assigned |
| PUT | `/exams/:id/marks` | `marks:create/update` (scoped) | bulk; checks status open, ranges, absent/exempt semantics ✎ |
| POST | `/exams/:id/results/compute` | `exams:approve` | dry-run + commit versions; deterministic ✎ |
| POST | `/exams/:id/results/approve\|publish` | `results:approve/publish` | publish immutable ✎ |
| POST | `/results/:id/correct` | `results:approve` | new version + reason ✎ |
| GET | `/results/students/:studentId` · `/results/exams/:examId/class/:sectionId` | `results:read` (scoped) | |
| GET | `/results/:id/report-card.pdf` | `results:print` | |

## 11. `/timetable`, `/homework` (P1)
`GET/PUT /timetable/periods` · `GET /timetable/{sections|teachers|rooms}/:id` · `PUT /timetable/sections/:id/slots` (conflict → 409 with conflicting slot) · `POST /timetable/publish` · `GET /timetable/revisions` · `POST /timetable/substitutions` · `GET /timetable/:id/print`.
`GET/POST/PATCH/DELETE /homework[/:id]` (teacher scoped) · `POST /homework/:id/submissions` (student) · `PATCH /homework/submissions/:id` (feedback/marks) · attachments via `/files`.

## 12. `/library`, `/transport`, `/payroll`, `/inventory` (P3 — catalogue only)
`/library/{books,copies,members,issues,returns,fines,reports}` · `/transport/{vehicles,drivers,routes,stops,allocations,reports}` · `/payroll/{structures,periods,slips,approve}` · `/inventory/{categories,items,movements,vendors,purchases,assets,allocations,maintenance}`. Each follows the same conventions; full table written at phase start.

## 13. `/notices`, `/notifications`

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET/POST/PATCH/DELETE | `/notices[/:id]` | `notices:*` | audience targeting; teacher limited to own classes ✎ |
| POST | `/notices/:id/publish` | `notices:create` | resolves recipients → notifications (consent-aware) ✎ |
| GET | `/notices/:id/receipts` | `notices:read` | read stats |
| GET | `/notifications` | self | in-app inbox, cursor |
| POST | `/notifications/:id/read` · `/notifications/read-all` | self | |
| GET/PUT | `/notifications/preferences` | self | |
| GET | `/notifications/deliveries` | `notices:read` | status per channel (real provider status) |

## 14. `/reports`
`GET /reports/catalog` (what the caller may run) · `POST /reports/run` `{key, filters}` → JSON page · `POST /reports/export` `{key, filters, format:csv|xlsx|pdf}` → job id (`reports:export`, `export` rate class, 👁) · `GET /reports/exports/:jobId` status · download via `/files/:id`. Keys: students, admissions, strength, withdrawals, attendance, low-attendance, fee-collection, outstanding, refunds, exam-results, staff, teacher-attendance (+P3 sets).

## 15. `/documents`, `/files`

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/files` | context-specific | multipart; size/type checks; returns `fileId` ✎ |
| GET | `/files/:id/download` | derived from owner entity | 302 to signed URL (prod) / stream (dev) 👁 for sensitive kinds |
| DELETE | `/files/:id` | owner-entity update perm | soft delete; retention rules |
| GET/POST/PATCH | `/documents/templates[/:id]` | `documents:manage` | |
| POST | `/documents/generate` | `documents:create` | certificate/ID card → `generated_documents` + PDF; unique doc no. ✎ |
| GET | `/documents/verify/:code` | **public, rate-limited** | returns only valid/invalid + doc type + school name (no PII) |

## 16. `/subscriptions`, `/support`, `/audit-logs` (school side)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/subscriptions/current` | `school.settings:read` | plan, status, limits, usage, invoices |
| POST | `/support/tickets` · GET `/support/tickets[/:id]` · POST `/…/messages` | any staff | |
| GET | `/audit-logs` | `audit:read` | cursor; filters actor/entity/date; school-only |

## 17. `/search`
`GET /search?q=&types=students,staff,guardians,receipts,admissions,books&limit=5` — fan-out of per-type scoped searches; each type independently permission-filtered; min 2 chars; rate-limited.

## 18. `/imports`

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/imports` | `imports:create` | upload file → batch `uploaded`; returns detected headers & sample |
| PUT | `/imports/:id/mapping` | `imports:create` | column mapping ✎ |
| POST | `/imports/:id/validate` | `imports:create` | job; produces preview + error report |
| POST | `/imports/:id/commit` | `imports:approve` | **Idempotency-Key**; job; chunked ✎ |
| GET | `/imports` · `/imports/:id` · `/imports/:id/errors.csv` | `imports:create` | history |
| POST | `/imports/:id/rollback` | `imports:approve` | only untouched rows ✎ |

## 19. Webhook & external endpoints
Only `/webhooks/razorpay` (P2) and `/documents/verify/:code`. No other unauthenticated write endpoints.

## 20. Endpoint count & what is MVP
≈ 260 endpoints in catalogue; MVP subset ≈ 110 (auth, platform-lite, school, users/roles, academics, students/guardians, staff-basic, attendance, fees/payments/receipts/reports, exams-core, notices/notifications, imports, files, audit, parent read APIs).
