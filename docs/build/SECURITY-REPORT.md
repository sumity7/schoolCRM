# Security Review — R1 (pass 1, 2026-11-10)

Reviewer: the build agent (self-review — **not** an independent assessment or penetration test; doc 12 Gate G3 still
requires an external review before real data). Scope: everything built for R1, with extra attention to this session's
additions (CSV import/export, admin screens, backups/tenant tools, deployment config).

## 1. Controls verified by executed tests
| Control | Evidence |
|---|---|
| Tenant isolation: every id-bearing school route attacked with another school's ids → 404 and the other school's data byte-identical; collection routes never leak foreign ids (incl. CSV bodies) | `rbac-isolation.test.ts` (harness fails if a new id route lacks an attack spec — the 6 import routes were added) |
| Deny-by-default RBAC; mutating routes must declare audit; strict schemas reject unknown keys / `schoolId` in payloads | route manifest tests |
| CSRF (JSON-only, custom header, Origin/Sec-Fetch-Site) incl. real cross-origin forgeries | `auth.test.ts`, E2E-02 |
| Session cookie HttpOnly, SameSite=Lax, `__Host-` + Secure in production; logout/suspension revoke sessions | E2E-01, auth tests |
| CSV formula injection neutralised on every exported cell (students, attendance, import problem files) | `imports.test.ts` |
| Import: size caps (3 MB / 2,000 rows / 60 columns) enforced server-side; idempotent commit; permissions split create vs approve | `imports.test.ts` |
| Backups encrypted (AES-256-GCM, scrypt), no plaintext PII in the file, tamper/wrong-passphrase detected before any write; tenant exports contain no credentials | `backup.test.ts` |
| Production startup refuses insecure config (cookie, localhost DB, non-https origins/base URL, no proxy hop, paid flags) | `kernel.test.ts` + manual run of the bundled API |
| Production CSP served and no violations across 6 screens, CSV download and theme switch | browser check against the standalone build |
| No `dangerouslySetInnerHTML`, `eval`, `$where` in app code | grep |

## 2. Findings
| # | Severity | Finding | Status |
|---|---|---|---|
| S-1 | Medium | Web CSP covered only framing (`frame-ancestors`), no script/connect restrictions | **Fixed**: full same-origin CSP in production (`script-src 'self' 'unsafe-inline'`, `connect-src 'self'`, `object-src 'none'` …) |
| S-2 | Medium | API listened on all interfaces; behind a proxy it should be reachable only from the proxy | **Fixed**: `HOST` defaults to `127.0.0.1`; production also requires `TRUST_PROXY_HOPS ≥ 1` and https origins |
| S-3 | High (data loss) | Backup writer's failure cleanup deleted a pre-existing file at the target path | **Fixed** (exclusive create first), regression test added |
| S-4 | Medium (availability) | Whole-school low-attendance report loaded every attendance record into memory (~3.5 s, memory grows with data) | **Fixed**: DB-side aggregation + covering index (p95 476 ms on 333k records) |
| S-5 | Low | `zod` < 4.6.6 advisory GHSA-mrhx-c7xc-m3w5 (memory on oversized constrained collections) | **Accepted for now**: every body is size-capped before validation (100 kB; 4 MB only for uploads, which hold one string), query parser cannot build arrays. Plan: zod 4 migration (breaking) before R3 |
| S-6 | Low | `postcss` inside `next` (GHSA-qx2v-qp2m-jg93 et al.) | **Accepted for now**: build-time only, processes our own CSS. Plan: Next 16 upgrade |
| S-7 | Low | CSP allows inline scripts (Next bootstrap without nonces) | Open: nonce-based CSP via middleware |
| S-8 | Low (privacy) | Import batches keep the raw uploaded rows (student PII) indefinitely | Open: purge raw rows N days after commit/rollback (needs a retention decision) |
| S-9 | Info | CSV export is a GET: a cross-site top-level link can make a logged-in user download their own school's file (Lax cookies) | Accepted: the attacker cannot read the file; every export is audited; export needs `students:export` |
| S-10 | Info | Rate limiting is in-memory (single process) | Known limitation; shared store needed if scaled out |

## 3. Not covered by this pass
External penetration test, dependency licence review, Linux host hardening (systemd sandboxing is configured but untested),
Caddy/TLS configuration (not installed here), secrets management on the real host, DPDP/legal review (D-12: no compliance
claims are made).
