# N. Missing Requirements, Contradictions & Decisions Needed

Reply with "use defaults" or answer by ID (e.g. "D-03: phone login; rest defaults"). Section C is the one that needs **you**.

## 0. DECISION LOG (authoritative; revision 3)

### 0.1 ACCEPTED
| ID | Decision | Notes |
|---|---|---|
| D-04 | 5–10 h/week solo, AI-assisted | planning baseline 7.5 h/week (D-29) |
| D-19 | Production budget ₹0/month **for now**; no real student data goes live until the Production-Readiness Gate (doc 12 §10) passes | dev/staging free + synthetic data only |
| D-27 | **Option A — attendance before fees** | R1 = student-management + attendance pilot |
| D-29 | Plan on 7.5 h/week | |
| D-01 *(provisional)* | Design for a generic CBSE-style school; **no CBSE-specific hard-coding**; validate real pilot-school requirements before each affected module is finalised | validation checkpoints §G |
| — | Five-release plan R1–R5 preserved; all mandatory security and production-readiness gates preserved | |
| — | Critical Playwright E2E kept (login/session persistence, CSRF, tenant switching, attendance submission, mobile workflows); API tests don't replace them | doc 11 §2.1 |

### 0.2 DEFERRED
| ID | Deferred to | What stays true meanwhile |
|---|---|---|
| D-03 parent login choice | **R3**, before parent-portal implementation | identity model flexible (email **or** phone identifiers); staff use email+password |
| D-26 funding source | until confirmed in writing | *Proposed:* pilot school under a written agreement — **not assumed to exist** |
| D-28 domain purchase & legal review | separate approval once a pilot **and** funding are confirmed | **no spending authorised now** |

### 0.3 CONDITIONAL
| ID | Condition | Where |
|---|---|---|
| D-23 architecture choices | **Not finally approved.** Seven ADRs await your per-ADR approval | [doc 16](16-architecture-decision-records.md) |

### 0.4 STILL OPEN (defaults proposed; ask by phase — see §F)
D-02, D-05–D-18, D-20–D-22, D-24, D-25.


## A. Missing requirements found in the spec

| # | Gap | Why it matters | Proposed handling |
|---|---|---|---|
| M1 | **No data-import phase** though §37 demands it | Pilot cannot start without importing existing students | Added to Phase 5 (doc 10) |
| M2 | **Audit, file storage, jobs, idempotency, sequences** not scheduled | Needed from the first feature | Foundation/kernel phases |
| M3 | **Multi-school users** (teacher at two schools, parent with kids in two) not modelled | Identity design | User ↔ Membership model (doc 05) |
| M4 | **Guardian ≠ login user**; guardians exist before they have accounts; shared phone numbers | Parent data model | `guardians` + `student_guardians` + optional `userId` |
| M5 | **Financial year vs academic year**; receipt numbering rules | Indian receipts/audits | D-06 |
| M6 | **Day-end cash closing, cashier day-book, cheque bounce, advance fees, carry-forward dues at rollover, fee on mid-session admission/withdrawal, transport fee link** | Real fee-desk operations | Included in FEE inventory; rules need D-07..D-09 |
| M7 | **Withdrawal/TC rules** (dues clearance before TC?) | Legal/process | Configurable policy; D-09 |
| M8 | **Consent & notice workflows** for notifications, portal, photos | DPDP — minors | `consent_records`; D-12/D-18 |
| M9 | **Data subject requests** (correction/erasure/export) with legal-hold carve-outs | DPDP | `data_requests` (P1) |
| M10 | **Records retention schedule** (how long to keep what) | Compliance, storage | Needs school/legal input; default proposal in Phase 1 |
| M11 | **Sibling linking & sibling discount** | Very common in India | Via shared guardians; concession kind `sibling` |
| M12 | **Hindi/regional language** UI and documents | Parents & receipts | D-17; i18n-ready strings from day 1 |
| M13 | **Offline/poor connectivity** for teachers | Rural/low-network schools | Out of scope v1; fast, light mobile pages; note risk |
| M14 | **Accessibility, print stylesheets, amount-in-words on receipts** | Usability/receipt practice | In UI system + receipt template |
| M15 | **Rate/abuse protection per tenant, quotas** | Fairness, cost | Entitlement service + rate classes |
| M16 | **Data export on termination / tenant offboarding** | Spec mentions lawful retention | Owner-triggered export; policy D-10 |
| M17 | **Customer support process & SLA**, status page, incident comms | You are the vendor | Doc 12 + support module; define SLA expectations with pilot |
| M18 | **Customer contract/ToS/Privacy Policy/DPA templates** | Commercial sale | Needs lawyer; not engineering |
| M19 | **Release notes & in-app help/training material** | Adoption | Onboarding guide & short videos post-MVP |
| M20 | **Analytics on product usage** (privacy-preserving) | Product decisions | Aggregate counters only; no child-level tracking |
| M21 | **Time-boxed edit windows and locks** (attendance, marks, closed fee days) | Data integrity | Policy settings (D-21) |
| M22 | **Mid-session admission (pro-rata fees), re-admission, name/DOB correction with proof** | Real operations | Workflow notes in doc 02 |
| M23 | **Multi-branch / school groups** | Chains will ask | Non-goal v1; `schoolId` model could later add `organizationId` |
| M24 | **Search normalisation** (spelling variants, Indic scripts) | Finding students fast | normalizedName field; tested |
| M25 | **Student ID cards & photo capture workflow** | Common ask | P2 |
| M26 | **Two-person rule for risky actions** (refund, mark change after publish) | Fraud prevention | Separation-of-duties flags |

## B. Contradictions, risky assumptions and unrealistic items in the spec

| # | Finding | Recommendation |
|---|---|---|
| C1 | **Separate Express API + cookie auth + free hosting on different domains** → cookies blocked as third-party; CORS/CSRF pain | Same-site deployment: Next.js rewrites `/api/*` to the API (or `app.` + `api.` on one domain). Needs a domain (D-02). **I recommend keeping Express as you specified.** |
| C2 | **Phase order**: auth before tenancy is circular; audit/files/jobs/imports/entitlements missing | Re-ordered plan in doc 10 §3 |
| C3 | **"Super Admin can manage all schools" vs "do not expose student data to support"** | Aggregate-only by default + audited break-glass (doc 06 §4) |
| C4 | **₹0 budget vs production of real children's data** | **Rev 2 (D-19 confirmed ₹0):** free for dev/staging; real-data go-live gated by doc 12 §10; funding path D-26 |
| C5 | **Free hosting vs commercial use** (e.g. some free plans non-commercial; sleeping servers) | Verify terms; use VPS for prod |
| C6 | **"Immutable financial records" vs "payment reversal/cancel"** | Reversal = new rows + status pointer; original untouched (doc 05 §6) |
| C7 | **Subscription expiry "never block or delete" vs "suspension"** | Suspension = read-only/export mode; policy D-10 |
| C8 | **Online fee payments (Razorpay)** — if fees land in *your* merchant account, you may be acting as a payment intermediary (regulatory/accounting implications) | MVP = manual payment recording. Online later via each school's own gateway account or split-settlement product, after legal/accounting advice (D-11) |
| C9 | **SMS/WhatsApp** need DLT registration/paid business APIs | MVP in-app + email only |
| C10 | **"Argon2id or bcrypt", "Vitest or Jest", "JWT or session"** — spec asks to choose one | Decided: Argon2id (bcrypt fallback), Vitest, server sessions |
| C11 | **Zero-budget + malware scanning, PITR backups, error monitoring, MFA SMS** | Use free/OSS equivalents (ClamAV, scripted dumps, Sentry free, TOTP) with documented limits |
| C12 | **Student login for minors** — age, consent, school policy undefined | D-16 |
| C13 | **Dashboard "analytics" for new school with no data** → empty states; spec forbids fake data | Designed empty states; demo data only in synthetic demo tenants labelled as such |
| C14 | **§46 "Never generate the entire ERP in one response" + Phase gating** vs 15 phases | Fine; plan reduces to 12 phases to pilot |
| C15 | **Global school-code/email uniqueness** vs "independent tenants" | D-14 |
| C16 | **Payroll "do not assume tax/statutory"** yet payroll in scope | Deferred (P3); configurable components only |
| C17 | **"Rank calculation", "grading" universal formula** vs CBSE/ICSE/State variations | Configurable scales; pilot's format drives v1 (D-15) |
| C18 | **MongoDB "referential integrity"** | App-level validation + same-tenant ref checks + block deletes with dependants |
| C19 | **Effort realism**: all listed modules for a solo dev at 5–10 h/week | **Rev 2:** R1 (smallest usable pilot) ≈ 570 h ≈ 19 months expected at 7.5 h/week; full MVP ≈ 1,055 h ≈ 3 years → release-based delivery with checkpoints (doc 15 §7). *Estimates, not promises.* |
| C20 | **"Real-time" expectations** (live parent notifications) | Not required; polling/refresh sufficient v1 |

## C. Decisions needed from you (with my proposed default)

| ID | Decision | Options | **My default** |
|---|---|---|---|
| **D-01** ✅ **ACCEPTED (provisional)** | **Pilot school profile.** Design for a *generic CBSE-style school* provisionally; **no CBSE-specific hard-coding**; real pilot-school requirements must be validated before each affected module is finalised | open | Board-neutral design rules and validation checkpoints in §G. Still wanted: anonymised sample Excel, sample report card, sample fee receipt |
| **D-02** | **Domain & URLs**: do you own/plan a domain? path-based school (single app URL) or vanity subdomains (`school.edunex.in`)? | own domain / none yet | Buy a domain; single `app.` URL, school from login |
| **D-03** ⏸ **DEFERRED to R3** | Login identifier for parents (email / phone+OTP / both). Decided **before parent-portal implementation (R3)**. Until then the identity model stays flexible | — | Staff use email+password in R1. Model supports email **or** phone identifiers without migration (doc 05 `users`, §G) |
| **D-04** ✅ **ACCEPTED** | **Development time: 5–10 h/week, solo, AI-assisted; includes learning, review, debugging, testing.** | — | Planning baseline **7.5 h/week**. R1 (smallest usable pilot) ≈ **570 h expected** (366 optimistic / 915 conservative) ≈ **19 months** expected at 7.5 h/week (12–31). Full MVP ≈ 1,055 h ≈ 3 years → delivered as releases R1–R5 (doc 15 §1A, §7). Re-baselined after Phases 2 and 3. Security/isolation/ledger/backup scope **not** reduced. Target go-live date: not fixed — derived from checkpoints; align to an April session start |
| **D-05** | **Pricing model** (per student/yr? per school/mo? tiers?) and student/staff limits per plan | — | Per-student/year with 3 tiers; decide before Phase 4 plan-entitlement design |
| **D-06** | **Receipt numbering & financial year**: per FY series (`PFX/2026-27/000123`) or continuous; reset on 1 April? separate series per cashier/counter? | — | Per school, per FY, single series, prefix configurable |
| **D-07** | **Discount/concession policy**: approval limits by role (₹/%)? who can grant sibling/staff-ward/scholarship? | — | Accountant ≤ 5 % or ₹500; Admin ≤ 25 %; above → Owner/Principal approval |
| **D-08** | **Late fee rule**: flat/per-day/%, grace days, cap, waiver authority, auto-apply or manual | — | Configurable per school; default none; manual apply with preview |
| **D-09** | **Refund/withdrawal policy**: which categories refundable, dues clearance before TC, approver | — | Admission/registration non-refundable by default; tuition pro-rata by school rule; Owner/Principal approves |
| **D-10** | **Subscription expiry policy**: grace days; after grace = read-only + export (no deletion) for N days? when may data be deleted (never automatically)? | — | 15-day grace → read-only (exports allowed) → suspended; **no automatic deletion**; deletion only by written request after retention period |
| **D-11** | **Online fee payment**: in MVP? whose gateway account? | none in MVP / school's own Razorpay / vendor aggregator | **None in MVP; manual payments.** Revisit with legal advice |
| **D-12** | **Legal entity & compliance**: do you have a registered business? who prepares ToS/Privacy/DPA? DPDP role analysis? | — | Engage a professional **before pilot**; I will implement privacy features, not make legal claims |
| **D-13** | **Sensitive fields**: collect Aadhaar / caste / religion / medical? | none / only if school insists (encrypted+restricted) | Do **not** collect Aadhaar/caste/religion; medical optional, restricted & audited |
| **D-14** | **Uniqueness**: one email can belong to multiple schools (yes in model). Must `school.officialEmail` and `school.code` be globally unique? | — | `code` unique; officialEmail unique among *live* schools |
| **D-15** | **Grading & report card**: marks/percentage/grades; CBSE-style terms/weightage; co-scholastic grades? Provide sample card | — | Configurable marks→percentage→grade bands; sample card drives template |
| **D-16** | **Student portal**: from which class/age? school-controlled toggle? | — | Off by default; enable per school from Class 6+ (guardian consent recorded) |
| **D-17** | **Languages**: English only MVP or Hindi UI too? Hindi names on documents? | — | English UI; Unicode names & Hindi in PDFs supported; UI i18n-ready |
| **D-18** | **Notification channels MVP**: in-app + email only? consent model for email/SMS to guardians? | — | In-app + email; consent captured at admission form; SMS/WhatsApp later |
| **D-19** ✅ **ACCEPTED** | **Production budget: ₹0/month.** Free/local tools for development; synthetic data only in dev/staging; **no real children's/school/financial data on unverified free infrastructure**; no assumed commercial-use rights, backups, security guarantees or SLA. | — | Consequence: development and staging proceed at ₹0, but **real-student go-live is blocked until the Production-Readiness Gate (doc 12 §10) passes**. Minimum viable production budget (all figures PENDING verification): **S-lite ≈ ₹1,500–4,000/month**, comfortable ≈ ₹5,000–6,500; a "zero-recurring" Tier Z exists only if every gate item is verified (not recommended). Unavoidable items: domain (~₹1,000/yr) and legal review (one-time, quote pending). Funding path → **D-26** |
| **D-20** | **Salary visibility**: can School Admin see salaries, or Owner/Accountant only? | — | Owner + Accountant only |
| **D-21** | **Attendance policy**: daily only or period-wise? edit window (same day / 24 h / approval)? late counts as present? | — | Daily; teacher can edit same day; later edits via correction approval; late = present for % |
| **D-22** | **Super Admin break-glass**: allowed at all? require school-owner consent? max duration? | — | Allowed, reason + owner notification, ≤ 4 h, read-only |
| **D-23** 🟡 **CONDITIONAL** | Architecture choices **not yet approved**; exact choices, rationale, trade-offs and consequences for 7 items are in [doc 16](16-architecture-decision-records.md): server sessions · Next→Express proxy · shared MongoDB+`schoolId` · Vitest · MongoDB job queue (atomic claiming, retries, idempotency, dedupe, stuck-job recovery, concurrency tests) · pdfmake · auth/tenancy order | approve / change / reject per ADR | My recommendation per ADR is in doc 16; ADR-5 design-only until R3, ADR-6 spike-gated at R2 |
| **D-24** | **Import commit mode**: all-or-nothing vs commit valid rows & report invalid | — | Commit valid rows, report rejected (with downloadable error file), rollback-able batch |
| **D-25** | **Pilot parallel-run**: will the school run Excel/paper alongside for the first month? | — | Yes — recommended for fee reconciliation confidence |
| **D-26** ⏸ **DEFERRED** | Production funding source. **Proposed: the pilot school under a written agreement. This funding is NOT assumed to exist** until confirmed in writing | — | Gate G9 stays blocked until confirmed; development unaffected |
| **D-27** ✅ **ACCEPTED** | **Option A — attendance before fees** | A / B | R1 = student-management + attendance pilot (doc 15). Option B not selected |
| **D-28** ⏸ **DEFERRED — no spend authorised** | Domain purchase and legal review need **separate approval** when a pilot and funding are confirmed | — | Phases 1–7 need no spend (localhost + synthetic data). Gate G5 (legal) and any public domain remain blocked until approved |
| **D-29** ✅ **ACCEPTED** | Plan on **7.5 h/week** | confirm / 5 / 10 | Re-baseline after Phases 2 and 3 |

## D. Questions to ask the pilot school (stakeholder workshop)
1. Walk me through a fee collection day; what do you reconcile at the end?  2. How are fees structured (instalments, due dates, transport, sibling rules, late fees)?  3. What reports does the owner/principal look at weekly?  4. How is attendance taken (daily/period)? who consolidates?  5. How are exams structured; sample report card; who enters marks?  6. How do you contact parents today (WhatsApp groups? SMS vendor)?  7. Who needs access to what? Any salary/medical confidentiality rules?  8. Where is your current data (Excel files, quality)?  9. Admissions process and forms.  10. Which devices do teachers/parents use?  11. Network reliability in the building.  12. Who is the decision-maker and data-protection contact?  13. What would make you stop using Excel on day 1?

## E. Revision 2 — change log (D-04 and D-19 confirmed)

| Document | Change |
|---|---|
| 14 (this) | D-04, D-19 marked **CONFIRMED** with consequences; added D-26–D-29; C4, C19 updated; this log and §F |
| 15 MVP | Single-drop MVP replaced by releases **R1–R5**; added smallest usable pilot (R1) scope, postponable list, "never cut" list; effort rewritten in hours + O/E/C scenarios at 5/7.5/10 h/week; checkpoints & trim list; DoD item 7 ties to the gate |
| 12 Deployment | Rewritten: strict dev/staging/prod separation table; ₹0 feasibility matrix; unavoidable expenses & risks; minimum viable production budget (all PENDING verification); funding paths; **Production-Readiness Gate G1–G9**; portability rules; verification-log process |
| 13 Risks | R01, R04, R07, R18, R26 rewritten; added R27 (velocity/estimate), R28 (real data in wrong place), R29 (can't maintain AI-written code) |
| 10 Dependencies | Phase plan re-sequenced into R1–R5 (new phase numbering); job queue, platform console, file uploads, parent portal moved later; gate inserted before any real data |
| 00 Index, 04 Architecture | Pointers to rev 2; portability section |
| **Unchanged** | All other decisions (D-01–D-03, D-05–D-18, D-20–D-25), architecture choices (D-23), data model, RBAC, API catalogue, isolation design, testing standards (except the E2E-breadth note in doc 15 §1C), threat model |

## E2. Revision 3 — change log (decisions approved / amended)

| Document | Change |
|---|---|
| 14 (this) | Decision log (§0) with accepted / deferred / conditional separated; rows D-01, D-03, D-23, D-26–D-29 updated; §F rewritten; §G provisional-assumption register |
| **16 (new)** | ADR-1…7 for conditional D-23, incl. full job-queue design and concurrency-test list |
| 15 MVP | R1 renamed **Student Management & Attendance Pilot** and described accurately; new §1D "operations outside R1"; Option A confirmed; E2E narrowing **reversed**; hours/calendar re-stated (+20 h expected for the full E2E scope) |
| 11 Testing | New §2.1 mandatory critical-flow E2E (login/session persistence, CSRF, tenant switching, attendance submission, mobile) |
| 10 Dependencies | R1 name; Phase 3 sub-order 3a–3e (ADR-7); Option B marked not selected |
| 05 / 07 Data & API | `users` and `auth_tokens` made identifier-flexible (email or phone); login takes `identifier` |
| 12 Deployment | Funding (D-26) marked unconfirmed; D-28 no-spend consequences |
| 13 Risks | R27 numbers updated; R30 added (R1 mistaken for a complete ERP) |
| 00 Index | Rev 3 summary and doc 16 listed |
| **Unchanged** | Five-release plan, security/isolation/audit/backup/restore scope, production-readiness gate G1–G9, data model, RBAC, API catalogue, threat model |

## F. Remaining decisions needing your input (revision 3)

**Needed now (to close Phase 0):** your per-ADR answers for **D-23** (doc 16 checklist).
**Needed before Phase 1:** nothing beyond D-23, provided Phase 1 proceeds on the generic CBSE-style assumption (D-01).
**Needed by phase (defaults apply on "use defaults"):** D-05 pricing/limits before Phase 4 · D-14, D-21 before Phases 3/6 · D-13, D-24 before Phase 5 · **D-03 before R3** · D-06–D-09, D-20, D-25 before R2 · D-15 before R4 · D-10, D-11, D-16–D-18, D-22 at the release that introduces them.
**Needed before any real-data go-live (not before building):** D-26 confirmation · D-28 spend approval (domain, legal review) · D-12 legal entity & reviewer · D-02 domain/URL scheme.

## G. Provisional assumptions (D-01) and validation checkpoints

**Board-neutral design rules (apply from Phase 1):** class names, levels and streams are data (no hard-coded "Class 1–12"); subjects, terms/exams, grading scales, fee heads, instalment schedules, session dates (default Apr–Mar, configurable), working days, section naming and report-card layout are **configuration or templates**, never code constants; no CBSE-only fields required; optional fields for board-specific identifiers.

| # | Provisional assumption | Must be validated with the pilot school before | Method |
|---|---|---|---|
| A-01 | Class/section structure is generic (levels × sections, one session per year) | Phase 4 school setup is finalised | walkthrough of their class list |
| A-02 | Student record fields (doc 05 `students`) | Phase 5 | compare against their admission form & Excel columns |
| A-03 | Attendance is daily, per class; edit rules (D-21) | Phase 6 | observe/ask how attendance is taken and corrected |
| A-04 | Fee structure model (categories, instalments, concessions) | **R2 start** | their fee schedule, concession rules, sample receipt |
| A-05 | Exam/grading model, report-card layout | **R4 start** | their report card, marking scheme, term structure |
| A-06 | Parent identifier (email vs phone) | **R3 start** (D-03) | ask what parents actually have/use |

If the pilot school's reality differs, the affected module's design is revised before implementation — recorded as an ADR/design note, not patched in later.
