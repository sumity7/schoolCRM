# EduNex ERP — Phase 0 Deliverables (Index)

**Status:** DRAFT for owner review — nothing implemented, nothing installed.
**Date:** 2026-11-09
**Project directory at start:** empty (greenfield; no existing code to protect).

## How to read these documents

Read in this order. If you only have 30 minutes, read **14** (decisions I need from you), then **15** (MVP), then **13** (risks).

| # | Deliverable | File |
|---|---|---|
| A | Product Requirements Document | [01-prd.md](01-prd.md) |
| B | Module & feature inventory (requirements register seed) | [02-module-inventory.md](02-module-inventory.md) |
| C | Role & permission matrix | [03-rbac-matrix.md](03-rbac-matrix.md) |
| D | System architecture + diagrams | [04-architecture.md](04-architecture.md) |
| E | Database data dictionary & schema design | [05-data-dictionary.md](05-data-dictionary.md) |
| F | Tenant isolation architecture & threat model | [06-tenant-isolation-threat-model.md](06-tenant-isolation-threat-model.md) |
| G | API endpoint specification | [07-api-spec.md](07-api-spec.md) |
| H | Frontend route & screen inventory | [08-frontend-routes.md](08-frontend-routes.md) |
| I | Backend module & folder structure | [09-backend-structure.md](09-backend-structure.md) |
| J | Module dependency map + proposed phase re-order | [10-dependency-map.md](10-dependency-map.md) |
| K | Testing & acceptance criteria | [11-testing-acceptance.md](11-testing-acceptance.md) |
| L | Deployment & infrastructure plan | [12-deployment-infra.md](12-deployment-infra.md) |
| M | Risk register | [13-risk-register.md](13-risk-register.md) |
| N | Missing requirements, contradictions, **decisions needed** | [14-missing-and-decisions.md](14-missing-and-decisions.md) |
| O | Prioritised MVP for the first pilot school | [15-mvp-scope.md](15-mvp-scope.md) |
| P | Architecture Decision Records (conditional D-23) | [16-architecture-decision-records.md](16-architecture-decision-records.md) |

## The five things you most need to know

1. **The full spec is a multi-year product.** 48 sections ≈ 35 modules. A solo developer cannot ship all of it before a first school needs software. Doc 15 defines an MVP (≈ 10 modules) that a real pilot school can run on; everything else is sequenced after.
2. **"₹0 budget" works for development, not for real student data in production.** Free database tiers typically lack reliable backups and SLAs, and some free hosting tiers prohibit commercial use. Doc 12 gives an honest cost picture. Details need verification against current provider terms before you commit.
3. **Four spec decisions conflict or are risky and need your call** (doc 14, §B): separate Express API vs. Next.js cookies; phase order (auth before tenancy is circular); online fee payments (collecting school fees through *your* gateway account raises regulatory questions); and Super Admin access vs. student privacy.
4. **Tenant isolation is designed as defence-in-depth** (doc 06): tenant context comes only from the server-side session, a single repository layer injects `schoolId`, linting forbids bypassing it, and a CI harness automatically attacks every route with a second tenant's identity.
5. **I've made recommendations but not invented business rules.** Late fees, discount limits, grading, refund policy, receipt numbering, age cut-offs, expiry policy: all listed as open questions with a proposed default in doc 14, §C.

## What I did NOT do (honest limitations of this phase)

- Per-endpoint JSON request/response schemas are **not** written out in prose here. They will be authored as Zod schemas in a shared package and emitted as OpenAPI per module at implementation time; writing ~300 schemas in markdown now would go stale immediately. Doc 07 is the full endpoint **catalogue** with permissions, scope and rules.
- The data dictionary (doc 05) is **field-level for MVP and finance collections** and **entity-level** (key fields, indexes, invariants) for post-MVP collections (library, transport, payroll, inventory). Field-level detail for those is finalised at the start of their phase.
- Cost figures and provider limits are from my general knowledge and are marked **"verify"**. I did not research live pricing in this phase.
- Legal/compliance points (DPDP Act, payment regulation, GST) are *design considerations*, not legal advice. They need a qualified professional.

## Revision 2 (D-04 and D-19 confirmed)

- **Time:** 5–10 h/week → delivery is now **releases R1–R5**; R1 (smallest usable pilot) ≈ 570 h expected ≈ 19 months at 7.5 h/week; full MVP ≈ 3 years. See [15](15-mvp-scope.md) §1A–§1C, §7 and the re-sequenced phases in [10](10-dependency-map.md) §3.
- **Budget:** ₹0/month → dev & staging at ₹0 with synthetic data; **real students only after the Production-Readiness Gate** ([12](12-deployment-infra.md) §10), which needs a funding path (D-26). All prices/terms are PENDING verification.
- **Risks** R01, R04, R07, R18, R26 rewritten; R27–R29 added ([13](13-risk-register.md)). **Change log and remaining decisions:** [14](14-missing-and-decisions.md) §E–§F.

## Revision 3 (decisions recorded)

- **Accepted:** D-04, D-19, D-27 (Option A, attendance first), D-29 (7.5 h/week), D-01 provisionally (generic CBSE-style, no hard-coding). **Deferred:** D-03 (to R3), D-26 (funding **not assumed**), D-28 (no spend authorised). **Conditional:** D-23 — see the seven ADRs in [16](16-architecture-decision-records.md). Full log: [14](14-missing-and-decisions.md) §0.
- **R1 is a Student Management & Attendance Pilot, not a complete School ERP**; what stays outside it: [15](15-mvp-scope.md) §1D. Five-release plan and all gates preserved.
- Critical Playwright E2E kept ([11](11-testing-acceptance.md) §2.1). Estimates re-stated: R1 ≈ 570 h expected ≈ 19 months at 7.5 h/week; full MVP ≈ 1,055 h.

## Approval gate

Per your rules I stop here. Please review doc 14 first and answer the numbered decisions (or say "use your defaults"), tell me which docs to change, and approve (or amend) the MVP in doc 15. I will not begin Phase 1/2 until you say so.
