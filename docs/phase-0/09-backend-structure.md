# I. Backend Module & Folder Structure

## 1. Repository layout (npm workspaces monorepo)

```
schoolCRM/
├─ apps/
│  ├─ web/                         # Next.js (App Router)
│  │  ├─ src/app/
│  │  │  ├─ (auth)/ (platform)/platform/ (school)/app/ (teacher)/teach/ (parent)/parent/ (student)/me/
│  │  │  └─ api/  → none (API lives in apps/api; /api/* proxied by next.config rewrites)
│  │  ├─ src/components/ui/        # shadcn/ui primitives
│  │  ├─ src/components/shared/    # DataTable, FilterBar, MoneyInput, …
│  │  ├─ src/features/<module>/    # components, hooks (TanStack Query), api client per module
│  │  ├─ src/lib/                  # api client (fetch wrapper), format (₹, dates), auth context
│  │  └─ e2e/                      # Playwright specs
│  └─ api/
│     ├─ src/
│     │  ├─ server.ts  worker.ts   # entrypoints (web process / job worker process)
│     │  ├─ app.ts                 # Express app factory (testable)
│     │  ├─ config/                # env.ts (Zod-validated), constants
│     │  ├─ core/
│     │  │  ├─ http/               # middleware chain: requestId, security, cors, csrf, rateLimit,
│     │  │  │                      #   session, tenant, entitlement, authorize, validate, errorHandler
│     │  │  ├─ tenancy/            # TenantContext (AsyncLocalStorage), TenantRepository, tenant plugin
│     │  │  ├─ db/                 # connection, transaction helper, index sync, counters
│     │  │  ├─ auth/               # hashing (argon2), tokens, session store
│     │  │  ├─ rbac/               # permission catalog usage, scope resolvers
│     │  │  ├─ audit/              # AuditService
│     │  │  ├─ errors/             # AppError classes
│     │  │  ├─ logging/            # pino + redaction
│     │  │  ├─ jobs/               # queue, worker loop, handlers registry
│     │  │  ├─ files/              # FileService + storage adapters (local, s3)
│     │  │  ├─ notifications/      # NotificationService + adapters (inApp, email, sms*, whatsapp*)
│     │  │  ├─ payments/           # PaymentGateway interface + mock + razorpay (later)
│     │  │  ├─ pdf/                # templates + renderer
│     │  │  └─ idempotency/
│     │  └─ modules/
│     │     ├─ auth/ platform/ schools/ users/ roles/
│     │     ├─ academics/ students/ guardians/ staff/ admissions/
│     │     ├─ attendance/ timetable/ homework/ calendar/
│     │     ├─ fees/ payments/ exams/ results/
│     │     ├─ notices/ notifications/ reports/ imports/ documents/ search/
│     │     ├─ subscriptions/ support/ audit/ privacy/
│     │     └─ library/ transport/ payroll/ inventory/       # P3
│     └─ test/                     # integration, isolation harness, fixtures, factories
├─ packages/
│  └─ shared/                      # Zod schemas, DTO types, permission catalog, enums, money/date utils
│     └─ src/{schemas,permissions,constants,utils}
├─ docs/                           # phase-0 … architecture, data dictionary, openapi, runbooks
├─ scripts/                        # seed, create-school, create-super-admin, verify-restore
├─ .github/workflows/              # ci.yml (lint, typecheck, test, audit, gitleaks)
├─ .env.example  .gitignore  package.json (workspaces)  tsconfig.base.json  eslint config
```

## 2. Module internal shape (identical for every module)

```
modules/students/
  students.routes.ts        # path + method + {permission, entitlement, tenancy, rateClass, schema refs}
  students.controller.ts    # thin HTTP adapter
  students.service.ts       # business rules, record-scope, transactions, audit calls
  students.repository.ts    # extends TenantRepository<Student>; ONLY file importing the model
  students.model.ts         # Mongoose schema + indexes
  students.policy.ts        # scope rules (which students can this membership see?)
  students.dto.ts           # response mappers (allow-list fields per role)
  students.events.ts        # emitted domain events (e.g. StudentWithdrawn)
  students.test.ts          # unit + integration tests; plus entries in isolation manifest
  index.ts                  # public service interface for other modules
```

**Import rules (lint-enforced):** controller→service→repository→model, never upward; modules import each other only via `index.ts`; `core/*` may not import `modules/*`; `packages/shared` imports nothing from apps.

## 3. Core services (the "platform kernel")

| Service | Responsibility |
|---|---|
| `TenantContext` / `TenantRepository` | isolation (doc 06) |
| `AuthService` + `SessionStore` | login, tokens, lockout, rotation |
| `PermissionService` | resolve effective permissions & scopes for membership; `can(ctx, key, resource?)` |
| `AuditService` | `record({action, entity, before, after})` with redaction allow-lists |
| `EntitlementService` | plan/limits/feature checks, usage counters (`assertWithinLimit('students')`) |
| `FileService` | upload/validate/download/sign |
| `NotificationService` | enqueue, preference/consent checks, dedupe |
| `JobQueue` | enqueue, claim, retry, dead-letter |
| `IdempotencyService` | key store & replay |
| `SequenceService` | per-school counters (invoiceNo, receiptNo, applicationNo) |
| `LedgerService` (in fees) | the only code that writes `ledger_entries`/`payments`; enforces invariants |
| `PdfService` | receipts, report cards, certificates; Noto fonts for Devanagari |
| `PaymentGateway` | `createOrder, verifyWebhook, fetchPayment`; `MockGateway` for dev/test |

## 4. Cross-module event flow (synchronous domain events inside the monolith; job-backed where slow)

```
StudentEnrolled ─► FeeService.generateAdmissionInvoice
PaymentRecorded ─► NotificationService (receipt to guardian) · AuditService
AttendanceAbsent ─► NotificationService (consent-gated)
ResultsPublished ─► NotificationService · PortalCacheInvalidate(none in v1)
StudentWithdrawn ─► FeeService.flagDues · PortalAccess.revoke · Transport.release (P3)
SubscriptionChanged ─► EntitlementService.refresh
```

## 5. Testing layout
`test/factories` (synthetic school/student/fee builders using faker — never real data) · `test/setup` (mongodb-memory-server **replica set**, per-suite DB) · `test/isolation` (route-manifest sweep, doc 06 §6) · `test/finance` (ledger invariants, idempotency, concurrency with parallel requests) · module `*.test.ts` beside code.

## 6. Scripts (no UI needed for these in MVP)
`create-super-admin` (prompts, MFA setup), `create-school` (provision tenant + owner invite + seed system roles/settings), `seed-demo` (synthetic data, **refuses to run when `NODE_ENV=production`**), `verify-ledger` (reconciliation), `restore-check` (backup drill).

## 7. Configuration
Single `env.ts` Zod schema; process exits with a clear message on invalid config. `.env.example` lists every variable with safe placeholder values. Secrets only via env/secret manager; `NEXT_PUBLIC_*` only for non-secret values.
