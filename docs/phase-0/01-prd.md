# A. Product Requirements Document (PRD)

## 1. Product summary

**EduNex ERP — "School Management. Simplified."** A multi-tenant SaaS used by independent private schools in India to run admissions, students, staff, attendance, fees, exams and parent communication from one platform. You (the vendor) operate the platform; each school is a *tenant*.

> *Beginner note:* "Multi-tenant" = one running copy of the software serves many schools, and each school only ever sees its own data — like many people sharing one apartment building, each with a private locked flat.

## 2. Problem and opportunity

Small/mid private schools in India typically run on Excel, paper receipts, WhatsApp groups and one-off desktop software. Pain points: fee leakage and reconciliation, no parent visibility, duplicate data entry, report-card effort, and no audit trail. A simple, reliable, affordable system with *trustworthy fee handling* and *parent communication* wins first; breadth (library, transport, payroll) matters later.

## 3. Personas

| Persona | Primary job | What "success" looks like |
|---|---|---|
| School Owner/Admin | Run the school, see money & strength | One dashboard, no Excel, trusted numbers |
| Accountant | Collect & reconcile fees | Receipt in <30 s, daily collection matches cash drawer |
| Teacher | Attendance, marks, homework | Attendance in <1 min per class, on a phone |
| Parent | Know child's status; pay/see dues | Phone-friendly view of attendance, dues, results |
| Receptionist | Enquiries, admission forms | No re-typing between enquiry → student |
| Vendor (you) | Onboard & bill schools, support | Create a school in minutes; see health & usage |

## 4. Goals / non-goals

**Goals (v1):** secure tenant isolation; correct, auditable fee ledger; mobile-friendly attendance and parent view; data import from Excel; one pilot school live and happy.

**Non-goals (v1):** native mobile apps, LMS/video classes, biometric/RFID hardware, multi-branch school groups, statutory payroll/tax engine, accounting/GL replacement (Tally), AI features, marketplace.

## 5. Business model assumptions (need confirmation — doc 14)

Subscription per school, likely priced per student/year with plan tiers. Platform billing in v1 is **manual** (Super Admin records subscriptions/invoices); automated Razorpay billing comes after the lifecycle is stable.

## 6. Guiding principles

1. **Tenant safety over convenience.** Isolation is enforced by construction, then tested adversarially.
2. **Money is append-only.** No UPDATE of a payment; corrections are new reversing records.
3. **Server is the authority.** Frontend hides things for UX only; every rule is enforced server-side.
4. **Configurable, not hardcoded.** Grading, fees, attendance policy, working days are per-school data.
5. **Ship a thin, finished slice** before breadth. No placeholder screens presented as done.
6. **Honest status.** Nothing is "done" until its acceptance tests ran and passed.
7. **Privacy by default** — it's children's data. Collect less, expose less, log access.

## 7. Constraints

- Solo developer + AI assistance; limited hours; no dedicated QA/DevOps.
- ₹0 for development; production cost must be explicitly approved.
- Stack fixed by you: Next.js (App Router) + Express + MongoDB/Mongoose + Zod + TypeScript strict.
- India context: INR, IST, academic year Apr–Mar (typical), Indian boards (CBSE/ICSE/State), DPDP Act 2023.

## 8. Requirements traceability scheme

Every requirement gets an ID `REQ-<MODULE>-<NNN>` (e.g. `REQ-FEE-014`), a priority (**P0** pilot-blocking, **P1** pilot-soon, **P2** later, **P3** future), a status (`Proposed → Approved → Designed → Implemented → Verified`), and links:

```
REQ-FEE-014 ──► task(s) T-xxx ──► test(s) TST-FEE-014-a/b ──► evidence (CI run id)
```

A single file `docs/requirements/register.csv` (created in Phase 1, seeded from doc 02) holds the register. A CI check fails if an `Approved` requirement has no linked test ID. Tests carry the REQ id in their title so it's greppable.

## 9. Success metrics for the pilot

| Metric | Target (proposed) |
|---|---|
| Cross-tenant leak incidents | 0 (and 100 % of isolation tests green) |
| Daily cash collection report equals physical cash | 100 % over 30 days |
| Attendance marked by teachers (digitally) | > 90 % of school days |
| Students imported without manual re-keying | > 95 % |
| Parent logins active in month 2 | > 40 % of linked families |
| P1 bugs open at go-live | 0 |

## 10. Compliance posture (design intent only — not legal advice)

- Vendor likely acts as **data processor/fiduciary-adjacent** for the school's students' data; this needs legal review (doc 14, D-12).
- Design for: purpose limitation, minimisation, verifiable guardian consent for minors, access/correction/erasure workflows with legal-retention carve-outs for financial & academic records, breach-response runbook, audit logging of access.
- Do **not** market the product as "DPDP compliant" until a qualified reviewer signs off.
