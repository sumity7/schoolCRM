# H. Frontend Route & Screen Inventory

Next.js App Router, route groups per audience. Authorization is enforced by the API; the UI only uses `/auth/me` permissions to **hide/disable** controls (UX), never as security. Every screen needs: loading skeleton, empty, error, success (toast), and permission-denied states.

**Tenancy in the URL:** none. The active school comes from the session (switcher in topbar for multi-school users). Optional later: `school-code.edunex.in` vanity subdomains (decision D-02).

**Distinct shells (not one identical dashboard):**
| Shell | Audience | Layout character |
|---|---|---|
| `platform` | Super Admin/Support | dense, operational: tables, health, billing |
| `school` | Owner/Admin/Principal/Accountant/Receptionist/Librarian/Transport | sidebar by module, role-filtered, KPI-first dashboards |
| `teacher` | Teachers/Class teachers | mobile-first, task-first: "Mark attendance", "Enter marks", today's timetable |
| `parent` | Parents | mobile-first, child switcher, cards: attendance, dues, results, notices |
| `student` | Students | simple, read-heavy |

Priority tags: **P0** MVP · **P1** · **P2** · **P3**.

## 1. Public & auth `(auth)`

| Route | Screen | P |
|---|---|---|
| `/login` | Email+password; shows "choose school" if >1 membership | P0 |
| `/forgot-password`, `/reset-password?token` | | P0 |
| `/accept-invite?token` | set password, join school | P0 |
| `/verify-email?token` | | P1 |
| `/mfa` | TOTP challenge/enrol | P1 |
| `/select-school` | membership picker | P0 |
| `/register-school` | public school registration request (feeds approval queue) | P1 (MVP: Super Admin creates schools) |
| `/verify/[code]` | public document verification | P2 |
| `/403`, `/404`, `/maintenance` | | P0 |

## 2. Platform `(platform)/platform/*`

| Route | Screen | P |
|---|---|---|
| `/platform` | Overview: schools by status, student/staff totals, expiring subs (real counts) | P0-lite |
| `/platform/schools` · `/new` · `/[id]` | list, create, detail (status actions, owner invite, usage, entitlement, audit) | P0 |
| `/platform/schools/[id]/support-access` | break-glass request & session banner | P1 |
| `/platform/onboarding` | requests queue & checklist tracking | P1 |
| `/platform/plans` · `/[id]` | plan & entitlement editor | P1 |
| `/platform/subscriptions` | list/renewals/manual record | P0-lite (manual) |
| `/platform/billing` | invoices/payments | P2 |
| `/platform/support` · `/[id]` | tickets | P1 |
| `/platform/audit` | platform audit viewer | P0 |
| `/platform/admins` | platform users | P1 |
| `/platform/announcements` | | P2 |
| `/platform/health` | jobs, errors, versions | P1 |
| `/platform/settings` | | P1 |

## 3. School admin shell `(school)/app/*`

### Dashboard & global
| Route | Screen | P |
|---|---|---|
| `/app` | Role-aware dashboard (Owner/Admin: strength, today's attendance %, collection today, dues; Principal: academics; Accountant: collection/dues) — real data only | P0 |
| `/app/search` + ⌘K palette | global search | P1 (P0 student search) |
| `/app/notifications` | inbox | P0 |
| `/app/profile`, `/app/profile/security` | own profile, password, sessions, MFA | P0 |

### Setup
| Route | Screen | P |
|---|---|---|
| `/app/onboarding` | go-live checklist | P0 |
| `/app/settings/school` | profile, logo, theme | P0 |
| `/app/settings/policies` | attendance, fee, grading, working days | P0 |
| `/app/settings/academic-sessions` | sessions, activate, rollover | P0 |
| `/app/settings/classes` · `/sections` · `/subjects` | structure & mapping, teacher assignments | P0 |
| `/app/settings/calendar` | holidays/events | P1 |
| `/app/settings/users` · `/roles` | invite, manage roles/permissions | P0 users / P1 roles UI |
| `/app/settings/notifications` | templates/channels | P1 |
| `/app/settings/subscription` | plan & usage | P0-lite |
| `/app/audit` | school audit log | P0 |

### People
| Route | Screen | P |
|---|---|---|
| `/app/students` | table: search, filters (class/section/status), pagination, export | P0 |
| `/app/students/new` | create (stepper: details → guardians → class → documents) | P0 |
| `/app/students/[id]` | tabs: Overview · Guardians · Academics/History · Attendance · Fees (permission) · Documents · Medical (permission) · Timeline | P0 |
| `/app/students/[id]/edit`, `/status`, `/print` | | P0 |
| `/app/students/promotion` | wizard: choose session→preview→commit | P0 (needed at year-end) |
| `/app/guardians` · `/[id]` | | P0 |
| `/app/staff` · `/new` · `/[id]` (tabs: Profile · Assignments · Documents · Salary (restricted) · Attendance · History) | | P0 basic / P1 full |
| `/app/admissions/enquiries` · `/applications` · `/[id]` | pipeline board + table | P1 |

### Daily operations
| Route | Screen | P |
|---|---|---|
| `/app/attendance` | pick class/section/date → mark (tap grid, "all present" default) | P0 |
| `/app/attendance/corrections` | approval queue | P0 |
| `/app/attendance/reports` | monthly, low attendance | P0 |
| `/app/timetable/*` | periods, builder (conflict highlighting), print | P1 |
| `/app/homework/*` | | P1 |
| `/app/notices` · `/new` · `/[id]` | audience picker, schedule, read stats | P0 |

### Finance `(requires financial:view)`
| Route | Screen | P |
|---|---|---|
| `/app/fees/categories` · `/structures` · `/structures/[id]` | | P0 |
| `/app/fees/concessions` | requests/approvals | P0 |
| `/app/fees/invoices` · `/generate` · `/[id]` | | P0 |
| `/app/fees/collect` | **fast collection screen**: student lookup → dues → mode → amount → confirm → receipt print | P0 |
| `/app/fees/payments` · `/[id]` | history, reverse (approval flow) | P0 |
| `/app/fees/refunds` | | P0 |
| `/app/fees/day-close` | | P1 |
| `/app/fees/reports/*` | collection, dues, mode, cashier day-book | P0 |

### Exams
| Route | Screen | P |
|---|---|---|
| `/app/exams` · `/new` · `/[id]` (Schedule · Marks status · Results) | | P0 |
| `/app/exams/grading-scales` | | P0 |
| `/app/exams/[id]/marks` | marks grid (keyboard-friendly), absent/exempt toggles | P0 |
| `/app/exams/[id]/results` | compute preview, approve, publish | P0 |
| `/app/results/report-cards` | generate/print | P1 |

### Reports, imports, documents
| Route | Screen | P |
|---|---|---|
| `/app/reports` (catalog) · `/[key]` | filters + table + export | P0 core |
| `/app/imports` · `/new` · `/[id]` | map → preview → errors → confirm | P0 |
| `/app/documents/templates`, `/generate` | certificates | P2 (bonafide/TC P1) |
| `/app/library/*`, `/app/transport/*`, `/app/payroll/*`, `/app/inventory/*` | advanced modules | P3 |
| `/app/support` | tickets | P1 |

## 4. Teacher shell `(teacher)/teach/*` (P0 mobile-first)
`/teach` (today: timetable, pending attendance, notices) · `/teach/attendance` · `/teach/attendance/[sectionId]` · `/teach/marks` · `/teach/marks/[examId]/[sectionId]/[subjectId]` · `/teach/homework` (P1) · `/teach/classes/[sectionId]` (roster, class report) · `/teach/leave` (P1) · `/teach/notices`. Backed by the same APIs with teacher scope; Class-teacher extras appear when assigned.

## 5. Parent shell `(parent)/parent/*` (P0 mobile-first)
`/parent` (child switcher + cards) · `/parent/[studentId]` overview · `/attendance` · `/fees` (dues, history, receipts; online pay P2) · `/results` · `/timetable` (P1) · `/homework` (P1) · `/notices` · `/notifications` · `/profile` (contact prefs, consent). Child ids not linked → 404 page.

## 6. Student shell `(student)/me/*` (P1)
`/me` · `/attendance` · `/timetable` · `/homework` · `/exams` · `/results` · `/notices`. Age/policy-gated (decision D-16).

## 7. Shared UI system (build once, reuse)
AppShell (Sidebar, Topbar, Breadcrumbs, SchoolSwitcher, ThemeToggle) · DataTable (server pagination/sort/filter, column visibility, row actions, empty/skeleton) · FilterBar · FormField kit (RHF+Zod, inline errors, a11y labels) · Dialog/ConfirmDialog (typed-confirm for destructive) · Toast · StatCard/ChartCard (Recharts; real data only) · FileUpload · StatusBadge · PermissionGate (UX only) · PrintLayout · Pagination · Stepper · DatePicker (Indian formats) · MoneyInput (₹, paise-safe) · ErrorBoundary.
Standards: WCAG 2.1 AA targets, keyboard nav, focus rings, contrast, `prefers-color-scheme` + manual light/dark, 360 px minimum width, touch targets ≥ 44 px on teacher/parent shells, locale `en-IN` number/date formatting.

## 8. Control completeness rule
Each button/link maps to a route or API in docs 07/08 **or** renders as disabled with a "Coming soon" tooltip and is listed in `docs/unavailable-controls.md`. A Playwright smoke test clicks every nav item per role and fails on dead links/blank pages.
