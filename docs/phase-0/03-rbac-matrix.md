# C. Roles & Permissions Matrix

## 1. Model (beginner-friendly)

- A **User** is a person's login (global, one email).
- A **Membership** connects a User to **one school** with **one or more Roles**. A teacher at two schools = two memberships.
- A **Role** is a named bundle of **permissions** (`resource:action`).
- A permission has a **scope** that limits *which records*: `own` (my own), `assigned` (my classes/subjects/children), `school` (all in my school), `platform`.
- Server check = *permission present* **AND** *record within scope* **AND** *tenant matches* **AND** *feature enabled by subscription*.

Four gates, in this order (all must pass): **Authenticated → Tenant/membership active → Feature entitlement on → Permission + scope**. Cross-tenant failures return **404** (not 403) so existence isn't leaked.

Actions: `create read update delete approve export print manage` + special `financial:view`. "Delete" on financial/academic records is **never** a true delete (soft/void only).

## 2. Platform roles

| Capability | Super Admin | Platform Support |
|---|---|---|
| Schools: list/create/approve/suspend | ✔ | read only |
| Plans, entitlements, platform settings | ✔ | — |
| Subscriptions & invoices | ✔ | read |
| Platform analytics (aggregate counts only) | ✔ | ✔ |
| Support tickets | ✔ | ✔ (assigned) |
| Platform audit logs | ✔ | own actions |
| Manage platform admins | ✔ | — |
| **Break-glass school access** (reason + time-box + read-only + audited, optional school consent) | ✔ | needs Super Admin grant |
| Student/staff PII, fee data, marks | **never by default** | **never by default** |

MFA mandatory for both.

## 3. School roles × modules (default system roles)

Legend: **C**reate **R**ead **U**pdate **D**elete(soft) **A**pprove **E**xport **P**rint · `*` = scoped (own/assigned) · `—` none · `$` needs `financial:view`

| Module / resource | Owner | Admin | Principal | Accountant | Teacher | Class Teacher | Librarian | Transport Mgr | Receptionist | Parent | Student |
|---|---|---|---|---|---|---|---|---|---|---|---|
| School settings/branding | CRUDA | CRU | R | — | — | — | — | — | — | — | — |
| Users, roles, memberships | CRUDA | CRU (no Owner/escalation) | R | — | — | — | — | — | — | — | — |
| Academic sessions/classes/sections/subjects | CRUDA | CRUD | R,A | — | R | R | R | R | R | — | — |
| Teacher/class/subject assignments | CRUD | CRUD | R,A | — | R* | R* | — | — | — | — | — |
| Admissions/enquiries | CRUDA | CRUDA | R,A | R | — | — | — | — | CRU | — | — |
| Students (profile) | CRUDE,P | CRUDE,P | R,E,P | R (fee fields) | R* | R*,U* limited | R (name/id) | R (transport fields) | CRU | R* (own children) | R* (self) |
| Student medical/emergency | R | R | R | — | — | R* | — | — | — | R* | — |
| Student documents | CRUD | CRUD | R | R | — | R* | — | — | CR | R* | R* |
| Guardians & parent links | CRUD | CRUD | R | R | — | R* | — | — | CRU | R* (self) | — |
| Staff profiles | CRUD | CRUD | R | R | R (self) | R (self) | R (self) | R (self) | R (self) | — | — |
| Staff salary/contract | R$ | R$ (if granted) | — | R$ | — | — | — | — | — | — | — |
| Student attendance | R,E | CRUD | R,E | — | CRU* | CRU* | — | R* (transport) | — | R* | R* |
| Attendance correction approval | A | A | A | — | request | A* (own class) | — | — | — | — | — |
| Staff attendance & leave | CRUDA | CRUDA | R,A | — | CR* (own leave) | CR* | CR* | CR* | CR* | — | — |
| Timetable | CRUD,A | CRUD | R,A | — | R* | R* | — | — | — | R* | R* |
| Homework | R | R | R | — | CRUD* | CRUD* | — | — | — | R* | R*, submit |
| Exams & schedules | CRUD | CRUD | R,A | — | R | R | — | — | — | R* (published) | R* |
| Marks entry | R | R | R,A | — | CRU* (own subject/class) | CRU* | — | — | — | — | — |
| Results publish/approve | A | A | A | — | — | — | — | — | — | — | — |
| Results/report cards | R,E,P | R,E,P | R,E,P | — | R* | R*,P* | — | — | — | R*,P* (published) | R*,P* |
| Fee structures/config | CRUD | CRUD | R | CRUD | — | — | — | — | — | — | — |
| Invoices | R$ | R$ | R$ | CRU$ | — | — | — | — | — | R* (canViewFees) | — |
| Collect payment / receipt | R$ | R$ | R$ | C,R,P$ | — | — | — | — | — | online pay (P2) | — |
| Discount ≤ limit / > limit | A (any) | A (≤ cfg) | A (≤ cfg) | C ≤ limit, request > | — | — | — | — | — | — | — |
| Refund / reversal / cancel receipt | A | request | A (optional) | request | — | — | — | — | — | — | — |
| Financial reports | R,E$ | R,E$ | R,E$ | R,E$ | — | — | — | — | — | — | — |
| Library | R | CRUD | R | — | R | R | CRUDE | — | — | R* | R* |
| Transport | R | CRUD | R | R (fees) | — | R* | — | CRUDE | — | R* (own child route) | R* |
| Payroll | CRUDA$ | R$ | — | CRU$ | — | — | — | — | — | — | — |
| Inventory/assets | CRUD | CRUD | R | CRU | — | — | CRU* | CRU* | — | — | — |
| Notices | CRUDA | CRUDA | CRUDA | C (finance notices) | C* (own classes) | C* | — | — | — | R* | R* |
| Reports (non-finance) | RE,P | RE,P | RE,P | — | R* | R* | R* (library) | R* | R* (admissions) | — | — |
| Imports | CRUA | CRUA | — | C (fee balances, approved) | — | — | — | — | — | — | — |
| Audit log (school) | R | R | R | — | — | — | — | — | — | — | — |
| Subscription/billing view | R | R | — | — | — | — | — | — | — | — | — |

**Scope reminders:** Teacher `*` = only classes/subjects assigned *in the active session*; Class Teacher = Teacher + their class roster; Parent `*` = verified linked children only; Student `*` = self only.

## 4. Special rules (cannot be expressed by a table cell)

1. **Privilege-escalation guard:** a user may only grant permissions they hold; only Owner can assign Owner; the last Owner cannot be removed or demoted.
2. **Separation of duties (configurable):** the person who requests a refund/discount override cannot approve their own request. Marks entered by teacher need Principal approval before publish when the school enables it.
3. **Sensitive fields** (medical, salary, bank details, documents) require *explicit* permission keys and every read is audit-logged.
4. **Exports** require `:export` (separate from `:read`), are rate-limited, audited, and tenant-scoped; PII-heavy exports can require reason.
5. **Time/State locks:** published results, closed fee days, finalised payroll are read-only except via a correction workflow.
6. **Custom roles (P1 UI):** built from the same permission list; cannot exceed the creator's own permissions; cannot include `platform:*`.
7. **Subscription entitlement:** a role may hold a permission for a module the school's plan lacks — request still fails (feature gate).

## 5. Permission key catalogue (starter, final list generated in Phase 3)

`school.settings:{read,update}` · `users:{create,read,update,delete}` · `roles:manage` · `academics:{create,read,update,delete,approve}` · `students:{create,read,update,delete,export,print}` · `students.medical:read` · `students.documents:{create,read,delete}` · `guardians:{create,read,update}` · `staff:{…}` · `staff.salary:read` · `attendance:{create,read,update,approve,export}` · `exams:{…}` · `marks:{create,read,update}` · `results:{read,approve,publish,export,print}` · `fees.config:{…}` · `invoices:{create,read}` · `payments:{create,read,print}` · `refunds:{request,approve}` · `discounts:{apply,approve}` · `reports:{read,export}` · `financial:view` · `notices:{create,read}` · `imports:{create,approve}` · `audit:read` · `platform.*` (platform roles only).

All permission constants live in one shared TypeScript file (`packages/shared`) consumed by API, UI and tests; a test asserts every route declares exactly one required permission (or an explicit `public`).
