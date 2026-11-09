# E. Database Data Dictionary & Schema Design (MongoDB / Mongoose)

**Depth:** field-level for platform, tenancy, MVP and finance collections. Entity-level (purpose, key fields, indexes, invariants) for post-MVP collections (§9); field-level for those is finalised at the start of their phase. This is the design of record; Phase 1/2 will turn it into Mongoose schemas + Zod.

## 0. Conventions (apply to every collection unless stated)

| Convention | Rule |
|---|---|
| `_id` | `ObjectId`. Never trusted as a secret. Cross-tenant guess → 404. |
| `schoolId*` | `ObjectId → schools._id`. **Required on every tenant-owned collection**, set only by the repository from TenantContext. First key of every index. |
| Audit fields | `createdAt, updatedAt` (Date, UTC), `createdBy, updatedBy` (`ObjectId → memberships`). |
| Soft delete | `deletedAt?, deletedBy?` where marked 🗑. Repos hide by default. 🔒 = **never deleted** (financial/academic history). |
| Concurrency | Mongoose `__v` as optimistic-lock; update requires expected version where users edit concurrently. |
| Money | integer **paise** (`Number`), suffix `Paise` in field name. Currency fixed `INR` in v1 (field kept for future). |
| Calendar day | `"YYYY-MM-DD"` string in school timezone (attendance date, DOB, due date). Instants are `Date`. |
| Enums | Strings, validated by Zod + Mongoose `enum`. |
| Embedded arrays | Only when bounded (≤ ~50) and owned by the parent; otherwise separate collection. |
| Uniques | Always include `schoolId` (e.g. `(schoolId, admissionNo)`), so two schools may reuse the same number. |
| Names | Collection = plural snake_case. |

`*` = required. `?` = optional. `→` = reference (not DB-enforced; service validates same-school).

---

## 1. Platform-level collections (no `schoolId`)

### `users` — a person's global login
`email?` (lowercased, unique-sparse) · `phone?` (E.164, unique-sparse) · **at least one of email/phone required** (D-03 deferred to R3 — identity model kept flexible; R1 staff use email) · `passwordHash*` (argon2id) · `name*` · `status*` (`invited|active|locked|disabled`) · `emailVerifiedAt?` · `failedLogins` (int) · `lockedUntil?` · `mfa?{ type:'totp', secretEnc, enabledAt, recoveryHashes[≤10] }` · `lastLoginAt?` · `platformRole?` (`super_admin|support`) · `createdAt/updatedAt`
**Indexes:** unique sparse `email`; unique sparse `phone`; sparse `platformRole`. Login resolves a normalised `identifier` to email or phone; throttling is keyed on the normalised identifier. **Never returned** with hash/secret. **Soft delete:** status `disabled` (no hard delete; erasure workflow anonymises).

### `sessions`
`userId*` · `tokenHash*` (sha256) · `activeMembershipId?` · `ip` · `userAgent` · `createdAt` · `lastSeenAt` · `expiresAt*` · `revokedAt?` · `supportGrantId?` (break-glass)
**Indexes:** unique `tokenHash`; `{userId, revokedAt}`; TTL on `expiresAt` (+ grace). 

### `auth_tokens` — reset / verify / invite
`userId?` · `channel*` (`email|phone`) · `destination*` · `purpose*` (`reset|verify|invite`) · `tokenHash*` · `membershipDraft?` (for invites) · `expiresAt*` · `usedAt?`
**Indexes:** unique `tokenHash`; TTL `expiresAt`.

### `schools` — the tenant root (`_id` **is** the schoolId)
`name*` · `code*` (unique, lowercase slug, immutable after go-live) · `type*` (`primary|secondary|senior_secondary|k12|other`) · `board?` (`cbse|icse|state|ib|other`) · `affiliationNo?` · `address*{line1,line2?,city*,state*,postalCode*}` · `officialEmail*` · `phone*` · `website?` · `principal?{name,email,phone}` · `owner*{name,email,phone}` · `logoFileId?` · `status*` (`requested|approved|onboarding|live|suspended|deactivated`) · `onboarding{ steps:{key→doneAt} }` (bounded ≤15) · `settings*{ timezone('Asia/Kolkata'), currency('INR'), language('en'), dateFormat, workingDays[1–7], academicYearStartMonth(4), themeColor, attendancePolicy{…}, feePolicy{lateFee?,discountLimits{roleKey→paise|pct}, receiptPrefix, receiptNumbering('fy'|'continuous')}, gradingPolicy{roundingMode,…}, modulesEnabled? (derived from plan), schemaVersion }` · `subscriptionId?` · `createdAt…`
**Indexes:** unique `code`; unique `officialEmail`(?—decision D-14); `{status}`. **Soft delete:** status only; 🔒 retention.

### `plans`
`key*` (unique) · `name*` · `priceMonthlyPaise?` · `priceAnnualPaise?` · `limits*{ students, staff, storageMb, smsPerMonth? }` · `features*` (`{moduleKey: boolean}`) · `trialDays` · `isPublic` · `archivedAt?`

### `subscriptions` (history retained; one *current* per school)
`schoolId*` (platform-owned despite the field) · `planKey*` · `status*` (`trial|active|grace|past_due|suspended|cancelled`) · `periodStart/End*` · `graceEndsAt?` · `limitsSnapshot` · `featuresSnapshot` · `billingCycle` · `isCurrent`
**Indexes:** unique partial `{schoolId}` where `isCurrent`; `{status, periodEnd}`.

### `platform_invoices`, `platform_payments` — Phase 13 (entity-level): `schoolId, subscriptionId, number (platform sequence), lines[], totalPaise, status, gateway refs`. Same immutability rules as school finance.

### `support_tickets` — `schoolId?`, `raisedBy`, `subject`, `status`, `assignedTo`, `messages[≤200→ else separate]`, `sharedContext?` (explicitly attached by school; the only school data support sees by default).

### `support_grants` (break-glass) — `schoolId*, grantedTo(userId)*, reason*, scope('read')*, startsAt*, expiresAt*(≤ 4 h), schoolConsent?{by,at}, revokedAt?` → every access under a grant is audited with `supportGrantId`.

### `gateway_events` — idempotent webhook inbox: `provider*, eventId*, signatureValid*, payload(redacted), receivedAt, processedAt?, result` **unique `(provider, eventId)`**.

---

## 2. Tenancy, identity & access (tenant-owned)

### `memberships`
`schoolId*` · `userId*` · `roleIds*` (→ roles; ≥1) · `status*` (`invited|active|suspended|ended`) · `personType*` (`staff|guardian|student|owner`) · `personId?` (→ staffs / guardians / students) · `invitedBy` · `endedAt?`
**Indexes:** unique `{schoolId, userId}`; `{userId, status}` (login: list my schools — the *only* deliberately cross-tenant read, performed inside auth module with `withoutTenant()` and audited); `{schoolId, personType, personId}`.
**Invariant:** ≥1 active Owner per live school.

### `roles`
`schoolId*` · `key*` (`owner,admin,principal,accountant,teacher,class_teacher,librarian,transport_manager,receptionist,parent,student`, or `custom_<slug>`) · `name*` · `isSystem*` · `permissions*` (array of `{key, scope}` — bounded ~150) · `description?`
**Indexes:** unique `{schoolId, key}`. System roles seeded per school from code templates (versioned `templateVersion`).

---

## 3. Academic structure

### `academic_sessions` 🔒
`schoolId*` · `name*` ("2026-27") · `startDate*` · `endDate*` (day strings) · `status*` (`draft|active|closed`) · `rolledOverFromId?`
**Indexes:** unique `{schoolId, name}`; **unique partial `{schoolId}` where `status='active'`** (one active session).

### `classes` (grade levels)
`schoolId*` · `sessionId*` · `name*` ("Class 5") · `order*` (int) · `stream?` · `isActive` · 🗑
**Indexes:** unique `{schoolId, sessionId, name}`.

### `sections`
`schoolId*` · `sessionId*` · `classId*` · `name*` ("A") · `capacity?` · `classTeacherId?` (→ staffs) · `roomNo?` · 🗑
**Indexes:** unique `{schoolId, sessionId, classId, name}`.

### `subjects`
`schoolId*` · `code*` · `name*` · `type*` (`core|optional|co_scholastic`) · 🗑 · **unique** `{schoolId, code}`.

### `class_subjects`
`schoolId*, sessionId*, classId*, subjectId*, isOptional, periodsPerWeek?` · unique `{schoolId, sessionId, classId, subjectId}`.

### `teacher_assignments`
`schoolId*, sessionId*, staffId*, sectionId*, subjectId?` (null = class-level) · `isClassTeacher` · unique `{schoolId, sessionId, staffId, sectionId, subjectId}`; index `{schoolId, sessionId, sectionId}` (used by every teacher-scope check).

### `calendar_events` — `schoolId*, sessionId*, date*|range, type*(holiday|event|exam|ptm), title*, appliesTo?(classIds)` · index `{schoolId, sessionId, date}`.

---

## 4. People

### `students` 🔒🗑(status-based)
`schoolId*` · `admissionNo*` · `studentCode?` (display ID) · `firstName*` `lastName?` · `dob*` · `gender?` (`m|f|o|undisclosed`) · `bloodGroup?` · `photoFileId?` · `contact?{phone?,email?}` · `address?` · `category?` (for reporting only if school requires) · `previousSchool?{name,class,tc?}` · `status*` (`applicant|active|transferred|withdrawn|graduated|alumni`) · `admissionDate*` · `currentEnrollmentId?` (denormalised pointer) · `medical?` (restricted: `{allergies,conditions,notes}`; encrypted-at-rest field-level optional P1) · `emergencyContacts[≤3]{name,relation,phone}` · `source?` (`admission|import`) · `importBatchId?`
**Indexes:** unique `{schoolId, admissionNo}`; `{schoolId, status, lastName}`; text/prefix `{schoolId, normalizedName}`; `{schoolId, 'contact.phone'}`; `{schoolId, importBatchId}`.
**Not collected by default:** Aadhaar, religion, caste, biometrics (data minimisation; decision D-13).

### `enrollments` 🔒 — one per student per session (history)
`schoolId*` · `studentId*` · `sessionId*` · `classId*` · `sectionId*` · `rollNo?` · `status*` (`active|promoted|retained|transferred|withdrawn|graduated`) · `joinedOn*` · `leftOn?` · `optionalSubjectIds[≤6]` · `promotionBatchId?`
**Indexes:** unique `{schoolId, studentId, sessionId}`; `{schoolId, sessionId, sectionId, status}` (class roster — most-used query); unique partial `{schoolId, sessionId, sectionId, rollNo}` where rollNo exists.
**Invariant:** promotion never edits an old enrollment's class/section; it closes it and creates a new one.

### `guardians`
`schoolId*` · `name*` · `phone*` · `email?` · `occupation?` · `address?` · `userId?` (link to login once invited) · `communicationPrefs{email,inApp,sms,whatsapp}` · `consent{ portal?, notifications? }{givenAt, recordedBy, method}` · 🗑
**Indexes:** `{schoolId, phone}` (NOT unique — shared phones occur), `{schoolId, userId}`.

### `student_guardians` — the access-control link
`schoolId*` · `studentId*` · `guardianId*` · `relationship*` (`father|mother|guardian|other`) · `isPrimary` · `canViewFees` · `canPickup` · `portalAccess*` (bool) · `verifiedAt?` · `verifiedBy?` · `endedAt?` (e.g. court order)
**Indexes:** unique `{schoolId, studentId, guardianId}`; `{schoolId, guardianId}`.
**Rule:** Parent API resolves children = active links where `verifiedAt != null && portalAccess && endedAt == null`.

### `staffs` 🔒🗑(status)
`schoolId*` · `employeeId*` · `name*` · `dob?` · `gender?` · `phone*` · `email?` · `address?` · `designation*` · `department?` · `kind*` (`teaching|non_teaching`) · `qualifications[≤10]` · `experienceYears?` · `joiningDate*` · `status*` (`active|on_leave|resigned|terminated`) · `endDate?` · `photoFileId?` · `userId?`
**Indexes:** unique `{schoolId, employeeId}`; `{schoolId, status, kind}`.

### `staff_compensation` (restricted; separate collection so ordinary reads never touch it)
`schoolId*` · `staffId*` · `effectiveFrom*` · `basicPaise` · `allowances[≤15]` · `deductions[≤15]` · `bankRef?(encrypted)` · `contractType?` — **append new row per change** (history). Index `{schoolId, staffId, effectiveFrom:-1}`. Permission `staff.salary:read`; reads audited.

### `admission_enquiries` / `admission_applications` (P1)
`schoolId*` · `applicantName*` · `dob*` · `appliedClassId*` · `sessionId*` · `guardian{name,phone,email}` · `status*` (`new|contacted|applied|under_review|approved|rejected|waitlisted|enrolled|withdrawn`) · `documents[≤15]{kind,fileId}` · `reviewedBy?` · `decisionNote?` · `studentId?` (set at registration) · `applicationNo*` (per-school sequence) · unique `{schoolId, applicationNo}`; `{schoolId, sessionId, status}`.

---

## 5. Attendance

### `attendance_records` 🔒 (one per student per day)
`schoolId*` · `sessionId*` · `studentId*` · `sectionId*` · `date*` ("YYYY-MM-DD") · `status*` (`present|absent|late|half_day|excused`) · `remark?` · `markedBy*` (membership) · `markedAt*` · `source` (`teacher|admin|import`) · `lastEditedBy?`
**Indexes:** **unique `{schoolId, studentId, date}`** (no duplicates, ever); `{schoolId, sectionId, date}` (class sheet); `{schoolId, sessionId, studentId, date}` (percentage).
**Write path:** `bulkWrite` upserts keyed on the unique pair.

### `attendance_corrections`
`schoolId*, attendanceRecordId*, requestedBy*, from*, to*, reason*, status*(pending|approved|rejected), decidedBy?, decidedAt?` · index `{schoolId, status, createdAt}`. Approval applies the change and writes an audit entry with before/after.

### `staff_attendance` (P1) — same pattern: unique `{schoolId, staffId, date}`; plus `leave_requests{schoolId, staffId, from, to, type, status, approvedBy}`.

---

## 6. Finance (P0 — highest rigour)

**Principles:** append-only; every state change is a new row; corrections are reversing rows; totals are *derived* from rows (and cached in invoices only as a denormalised convenience that a reconciliation job verifies).

### `fee_categories`
`schoolId*, key*, name*, kind*(tuition|admission|exam|transport|library|other), isRefundable, active` · unique `{schoolId, key}` · 🗑.

### `fee_structures` (versioned)
`schoolId*` · `sessionId*` · `classId*` · `name*` · `version*` (int) · `status*` (`draft|published|superseded`) · `items*[≤30]{categoryId*, amountPaise*, installments*[{label, dueDate, amountPaise}]}` · `lateFeeRule?{type:'flat'|'per_day'|'percent', amount, graceDays, capPaise?}` · `publishedAt?`
**Indexes:** unique `{schoolId, sessionId, classId, name, version}`. Published versions immutable.

### `student_concessions`
`schoolId*, studentId*, sessionId*, kind*(scholarship|sibling|staff_ward|merit|other), valueType*(flat|percent), value*, categoryId?, reason*, approvedBy*, validFrom?, validTo?, status` · index `{schoolId, studentId, sessionId}`.

### `invoices` 🔒
`schoolId*` · `invoiceNo*` (per-school sequence) · `studentId*` · `enrollmentId*` · `sessionId*` · `structureId*+version` · `period?`/`installmentLabel*` · `dueDate*` · `lines*[≤30]{categoryId, description, amountPaise}` · `concessionLines[]{concessionId, amountPaise}` · `lateFeePaise` (applied via ledger entries, cached here) · `totalPaise*` · `paidPaise` (cached) · `balancePaise` (cached) · `status*` (`open|partially_paid|paid|void|written_off`) · `voidReason?` · `generatedBy` · `generationKey*`
**Indexes:** unique `{schoolId, invoiceNo}`; **unique `{schoolId, studentId, sessionId, structureId, installmentLabel}`** (re-running generation can't double-bill); `{schoolId, status, dueDate}` (dues); `{schoolId, studentId, sessionId}`.

### `payments` 🔒 (immutable — no update/delete route exists)
`schoolId*` · `studentId*` · `amountPaise*` (> 0) · `mode*` (`cash|upi|bank_transfer|cheque|online`) · `reference?` (UTR/cheque no./gateway id) · `chequeDetails?{bank,no,date,status}` · `paidOn*` (date) · `receivedBy*` · `status*` (`recorded|reversed`) — *the only mutable field is `status` flipped by reversal, plus `reversalId`* · `reversalId?` · `idempotencyKey*` · `gateway?{provider,orderId,paymentId,env('test'|'live')}` · `unallocatedPaise` (advance)
**Indexes:** unique `{schoolId, idempotencyKey}`; unique sparse `{schoolId, 'gateway.paymentId'}`; `{schoolId, paidOn}` (day-book); `{schoolId, studentId, paidOn}`; `{schoolId, receivedBy, paidOn}` (cashier day-book).

### `payment_allocations` 🔒
`schoolId*, paymentId*, invoiceId*, amountPaise*` · unique `{schoolId, paymentId, invoiceId}`; `{schoolId, invoiceId}`.

### `receipts` 🔒
`schoolId*` · `receiptNo*` (e.g. `PREFIX/2026-27/000123`) · `paymentId*` · `studentId*` · `issuedOn*` · `fileId?` (rendered PDF) · `status*` (`valid|cancelled`) · `cancelledByReversalId?`
**Indexes:** **unique `{schoolId, receiptNo}`**; unique `{schoolId, paymentId}`.
**Numbering:** `counters` doc `{schoolId, key:'receipt:2026-27', seq}`; `findOneAndUpdate({$inc:{seq:1}})` **inside the payment transaction**. Gaps only if business decides to cancel; a rolled-back transaction rolls back the increment too. Series/FY rules = decision D-06.

### `refunds` 🔒
`schoolId*, paymentId*, invoiceId?, amountPaise*, reason*, status*(requested|approved|rejected|paid), requestedBy*, approvedBy?, paidOn?, mode?, reference?` · rule: `requestedBy ≠ approvedBy` (configurable); index `{schoolId, status}`.

### `ledger_entries` 🔒 (append-only financial truth)
`schoolId*` · `studentId*` · `invoiceId?` · `paymentId?` · `refundId?` · `type*` (`charge|late_fee|concession|payment|refund|reversal|adjustment|write_off`) · `amountPaise*` (signed: charges +, payments −) · `occurredOn*` · `memo?` · `reversesEntryId?` · `createdBy*`
**Indexes:** `{schoolId, studentId, occurredOn}`; `{schoolId, invoiceId}`; `{schoolId, type, occurredOn}`.
**Invariant (tested):** for each invoice, `Σ ledger = balancePaise`; reconciliation job asserts it nightly and alerts on mismatch.

### `day_closings` — `schoolId*, date*, closedBy*, cashTotalPaise, nonCashTotalPaise, countedCashPaise?, note?` · unique `{schoolId, date}`. After closing, new payments with `paidOn` that day are rejected unless re-opened (audited).

### `idempotency_keys`
`schoolId*, key*, route*, requestHash*, responseStatus, responseBody(≤64 KB), createdAt` · unique `{schoolId, key, route}` · TTL 48 h (financial truth is in `payments`, not here).

---

## 7. Examinations & results (P0 core)

### `grading_scales` (versioned)
`schoolId*, name*, version*, bands*[≤15]{minPct, maxPct, grade, gradePoint?, remark?}, roundingMode*, passPct?, status` · unique `{schoolId, name, version}`. Published versions immutable.

### `exams`
`schoolId*, sessionId*, name*, termKey?, type*(unit|midterm|final|practical|internal), classIds[≤20], gradingScaleId*+version, weightagePct?, status*(draft|scheduled|marks_open|marks_locked|approved|published)` · index `{schoolId, sessionId, status}`.

### `exam_subjects` (schedule + rules)
`schoolId*, examId*, classId*, subjectId*, date?, startTime?, durationMin?, maxMarks*, passMarks*, components?[≤4]{name,max}` · unique `{schoolId, examId, classId, subjectId}`.

### `marks`
`schoolId*, examId*, examSubjectId*, studentId*, enrollmentId*, obtained?(number | null), components?, status*(entered|absent|exempt|not_entered), enteredBy*, enteredAt, lockedAt?` · **unique `{schoolId, examSubjectId, studentId}`**; `{schoolId, examId, enrollmentId}`. `null` ≠ 0.

### `results` 🔒 (computed snapshot, immutable once published)
`schoolId*, examId*, studentId*, enrollmentId*, subjectResults[≤20]{subjectId, obtained, max, grade, passed}, totalObtained, totalMax, percentage (rounded per policy), grade?, resultStatus(pass|fail|incomplete), rank?, gradingScaleSnapshot{id,version}, version*, publishedAt?, supersededByVersion?` · unique `{schoolId, examId, studentId, version}`. Corrections create version+1 with `result_corrections{reason, by, before, after}`.

---

## 8. Cross-cutting tenant collections

| Collection | Key fields | Indexes / notes |
|---|---|---|
| `audit_logs` 🔒 | `schoolId?`(null=platform), `actorUserId`, `actorMembershipId?`, `action*`, `entityType`, `entityId`, `before?`,`after?`(redacted allow-list), `ip`, `userAgent`, `requestId`, `supportGrantId?`, `at*` | `{schoolId, at:-1}`, `{schoolId, entityType, entityId, at}`; **append-only** (DB user for app has no update/delete on it where Atlas roles allow; otherwise code-level). No TTL on financial/permission events. |
| `files` | `schoolId*`, `kind*`, `ownerType`,`ownerId`, `storageKey*`, `originalName`, `mime*`(sniffed), `sizeBytes*`, `sha256`, `uploadedBy*`, `scanStatus`, 🗑 | `{schoolId, ownerType, ownerId}`; unique `storageKey` |
| `notices` | `schoolId*, title*, body*(sanitised/plain+limited markdown), audience*{type:school\|class\|section\|role\|individuals, ids[≤200]}, attachmentFileIds[≤5], publishAt, expiresAt?, status, createdBy` | `{schoolId, status, publishAt:-1}`; audience resolved to recipients at publish time into notifications |
| `notifications` | `schoolId*, recipientMembershipId*|guardianId, channel*, templateKey*, payload, dedupeKey*, status*(queued\|sent\|failed\|delivered\|read), providerMessageId?, attempts, lastError?, readAt?` | unique `{schoolId, dedupeKey, channel, recipient}`; `{schoolId, recipientMembershipId, readAt, createdAt:-1}` |
| `consent_records` 🔒 | `schoolId*, subjectType(guardian\|student\|staff), subjectId, purpose*, granted*, grantedBy, method, noticeVersion, at, withdrawnAt?` | `{schoolId, subjectType, subjectId, purpose}` |
| `import_batches` | `schoolId*, entity*, fileId, mapping, status*(uploaded\|validated\|committing\|done\|failed\|rolled_back), counts{total,ok,skipped,rejected}, errorReportFileId?, createdBy, committedAt?` | rows validated in memory/temp; committed records carry `importBatchId` |
| `jobs` | `type, payload, schoolId?, status, attempts, runAt, lockedUntil, lastError, idempotencyKey` | `{status, runAt}`; unique sparse `idempotencyKey` |
| `counters` | `schoolId*, key*, seq` | unique `{schoolId, key}`; only via `$inc` |
| `data_requests` (P1) | `schoolId*, subjectType/Id, kind(access\|correction\|erasure\|export), status, legalHoldNote, decidedBy` | privacy workflow |

---

## 9. Post-MVP collections (entity-level; fields finalised at phase start)

| Entity | Purpose / key fields | Critical indexes & invariants |
|---|---|---|
| `timetable_periods`, `timetable_slots`, `timetable_revisions` | period config; slot = `(sectionId, day, periodId, subjectId, staffId, roomId?)` | **unique** per `(sectionId,day,period)`, `(staffId,day,period)`, `(roomId,day,period)` → conflicts rejected by the DB, not just code |
| `homework`, `homework_submissions` | assignment with due date, attachments[≤5]; submission per student | unique `(homeworkId, studentId)` |
| `library_books`, `library_copies`, `library_transactions`, `library_members` | catalogue / physical copy with `status` | atomic `findOneAndUpdate({status:'available'}→'issued')` prevents double issue; unique `(schoolId, accessionNo)` |
| `vehicles`, `drivers`, `routes`, `route_stops`, `transport_allocations` | capacity, docs expiry, route fee | allocation count ≤ capacity (transactional); unique `(sessionId, studentId)`; **no GPS/location data in v1** |
| `payroll_periods`, `payslips` 🔒 | immutable once approved; reads need `financial:view` | unique `(schoolId, staffId, periodId)` |
| `inventory_items`, `stock_movements` 🔒, `vendors`, `purchases`, `assets`, `asset_allocations`, `maintenance_records` | stock = Σ movements | movements append-only |
| `generated_documents` 🔒 | `docType, subjectId, docNo (unique per school), verificationCode, fileId, templateVersion` | history preserved |
| `document_templates` | per-school, versioned, sanitised placeholders only | |
| `leave_requests`, `staff_attendance` | see §5 | |

## 10. Index & capacity notes

- Every query in the API spec must be backed by an index listed here; Phase 2 includes a test that runs `explain()` on the top ~30 queries against a seeded dataset and fails on `COLLSCAN`.
- Rough pilot volume (1 school, 1,000 students, 1 year): attendance ≈ 250 k docs; ledger ≈ 40 k; audit ≈ 200 k; total well under 1 GB incl. indexes — but the **free tier's storage cap is easy to hit with audit + attendance + files-metadata growth** (verify current cap; doc 12).
- Plan sharding-free: single replica set suffices for hundreds of small schools; the `schoolId`-first indexing means a future shard key `{schoolId: hashed}` is viable.
