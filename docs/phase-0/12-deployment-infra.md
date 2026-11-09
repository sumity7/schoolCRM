# L. Deployment & Infrastructure Plan (Revision 2 — D-19 confirmed: ₹0/month production budget)

> **Verification warning.** Free-tier limits, prices and commercial-use terms change often. Every figure and every provider claim below is from my general knowledge and is marked **PENDING VERIFICATION** until it is recorded in `docs/verification-log.md` (§12) with a source link and date. I have not researched live pricing or terms.

## 1. Honest headline (updated)

- **Development and staging at ₹0 is realistic** — using local tools and free tiers, with **synthetic data only**.
- **Production with real children's data at ₹0/month is *not currently justified*.** Under your confirmed rules (no real data on unverified free infrastructure; no assumption of commercial-use rights, reliable backups, security guarantees or SLA), **real students cannot be onboarded until the Production-Readiness Gate (§10) passes.** With a ₹0 budget that gate may be unreachable unless (a) a zero-cost option is genuinely verified to meet every gate item, or (b) someone funds a small recurring cost (e.g. the pilot school — decision D-26).
- This does **not** block development. Everything through the end of R1 can be built, tested and demoed on ₹0 infrastructure with synthetic data. The funding question only has to be answered before go-live.

## 2. Environments (strictly separated)

| | **Local dev** | **Staging** | **Production** |
|---|---|---|---|
| Purpose | build & test | pre-release rehearsal, demos | real schools |
| Data | synthetic (faker seed) | **synthetic only** (never a copy of real data, not even "anonymised" without review) | real — only after Gate §10 |
| Compute | your laptop | free tier / free VM (terms to verify; staging is non-revenue) | host with **verified commercial-use rights** |
| Database | `mongodb-memory-server` (replica set) for tests; local `mongod` or free Atlas dev cluster | separate free Atlas project/cluster | **separate** paid/verified DB with backups |
| File storage | local disk | free S3-compatible bucket (separate) | private bucket, separate credentials, versioning |
| Email | log sink / local SMTP catcher | provider sandbox or sink | verified sender domain (SPF/DKIM/DMARC) |
| Payment gateway | mock (and later test-mode keys) | test-mode keys | live keys **only here** |
| Secrets | `.env` (git-ignored) | staging secret set | production secret set — unique values, never reused |
| Access | you | you | you, least-privilege, MFA on every provider account |
| Cost target | ₹0 | ₹0 | see §6 |
| UI banner | "DEV" | "STAGING — synthetic data" | none |

Hard rules: separate DB **and** credentials **and** domains per environment; env validated at boot (app refuses to start on mismatch); `seed-demo` and any "reset" script refuse to run when `NODE_ENV=production`; the school's real Excel files never enter dev/staging (create a synthetic file with the same column structure instead); production deploys are manual-approval only.

## 3. What can genuinely operate at ₹0 (PENDING VERIFICATION)

| Component | Dev | Staging | Production | Conditions / risks |
|---|---|---|---|---|
| Source control (GitHub, private repo) | ✔ | ✔ | ✔ | free plan limits — verify |
| CI (GitHub Actions) | ✔ | ✔ | ✔ | free minutes cap for private repos — verify |
| Node / Next.js / Express / Vitest / Playwright / ESLint | ✔ (OSS) | ✔ | ✔ | — |
| MongoDB | ✔ local / memory-server | ✔ Atlas free dev tier | ⚠ not recommended | free tier: small storage, shared, **no restorable backups (verify)**, no SLA; may or may not allow commercial use — verify |
| App hosting | ✔ laptop | ✔ free web hosts (cold starts OK) | ⚠ only if a free VM's terms permit commercial use *and* it passes the gate | free hosts often sleep/ban commercial; free VMs can be reclaimed — verify |
| File storage | ✔ local disk | ✔ free object-storage allowance | ⚠ allowance small; verify terms | privacy: bucket must be private |
| Email sending | ✔ sink | ✔ free-tier provider | ⚠ free daily caps; need your own domain for good deliverability | — |
| Domain name | ✔ not needed | ✔ free host subdomain | ✘ **needed (≈ ₹800–1,500/yr, verify)** | required for same-site cookies, email authentication, trust |
| TLS certificates | ✔ | ✔ | ✔ (Let's Encrypt / provider-managed) | — |
| Error tracking / uptime monitoring | ✔ | ✔ | ✔ free tiers (verify limits) | alert-delivery must be tested |
| Payment gateway | ✔ mock | ✔ test mode | deferred (D-11) | — |
| SMS / WhatsApp | ✘ not free | ✘ | ✘ | DLT registration, per-message fees; deferred |
| Legal review (privacy notice, ToS, DPA, DPDP analysis) | — | — | ✘ **cannot be ₹0** | one-time cost, quote pending |
| Penetration test by a third party | optional | — | optional | self-run ZAP baseline + checklist at ₹0 |

## 4. Component options (reference; unchanged from rev 1 except for verification markers)

**Web/API hosting.** Vercel Hobby is restricted to non-commercial use (verify) → staging only. Cloudflare Pages/Workers: commercial allowed on free (verify) but Next.js App-Router compatibility has gaps; the app will therefore be built as a plain **Node server** (`output: 'standalone'`) to stay portable (§11). Render free: sleeps after inactivity → staging only. Fly.io/Railway: small paid usage (verify). Oracle Cloud Always-Free VM: generous but approval/idle-reclaim/ops burden (verify). Small VPS in India: ≈ ₹500–1,000/month (verify).
**Database.** Atlas free (M0): dev/staging. Atlas lower-cost paid shared/usage-capped tier (e.g. "Flex") — existence, price and backup features **PENDING VERIFICATION**. Atlas M10 dedicated ≈ US$55–60/month (verify) with PITR options. Self-hosted MongoDB on a VPS: cheapest, but you own backups/patching/replica-set — high risk at 5–10 h/week.
**Storage.** Local (dev) → S3-compatible private bucket (Cloudflare R2 / Backblaze B2 / S3), free allowances verify.
**Email.** SES / Brevo / Resend / Mailgun (free allowances verify); SPF/DKIM/DMARC required.
**Monitoring.** Sentry free, UptimeRobot/Better Stack free, pino logs + logrotate.
**CI/CD.** GitHub Actions: lint, typecheck, test, `npm audit`, gitleaks; deploy by SSH/rsync or container pull; staging automatic, production manual approval.
**Domain/DNS.** `edunex.in`/`.com`; `app.` serves web + API same-origin; DNS at Cloudflare free.

## 5. Unavoidable production expenses and their risks

| Expense | Why unavoidable | Approx. (PENDING) | Risk if skipped / cheapened |
|---|---|---|---|
| **Compute host with verified commercial rights** | A school cannot run on a host that may sleep, throttle, or forbid commercial use | ₹0 (if a free VM is verified) – ₹1,000/mo | downtime at 8 AM, terms violation → account termination = data loss |
| **Database with restorable backups** | "A backup is not reliable until restored"; fee ledger is legally/financially sensitive | ₹0 (self-run, high risk) – ₹5,000/mo | unrecoverable loss of attendance/fee history; trust and legal exposure |
| **Off-site encrypted backup storage (separate provider)** | A backup on the same account/provider is not disaster-proof | ≈ ₹0–200/mo | single-provider failure/ban wipes both data and backups |
| **Domain** | same-site cookies, email authentication, professional trust | ≈ ₹800–1,500/yr | broken login, spam-foldered emails |
| **Legal review** (privacy notice, ToS, school DPA, DPDP/children's data, receipts/GST handling) | processing children's data commercially; Gate item G5 | one-time — **quote pending** | regulatory/contractual exposure; cannot honestly claim compliance |
| **Email sending** | invites, resets, receipts | ₹0 (free tier) – ₹200/mo | blocked invites/resets if caps hit |
| **Your time on ops** | patching, restore drills, incident response | 5–10 h/week budget is *shared* with development | ops neglect → security debt |
| *(Later)* SMS/WhatsApp, payment-gateway fees, paid monitoring, third-party pen-test | only when those features ship | — | — |

## 6. Minimum viable production budget (all figures PENDING VERIFICATION)

| Tier | Composition | Recurring / month | Notes |
|---|---|---|---|
| **Z — "zero-recurring"** (only if *every* §10 item is verified) | Free VM with verified commercial terms + **self-run** MongoDB (single-node replica set → transactions but no HA) + nightly encrypted dump to a *different* provider's free bucket + free monitoring/email | ≈ ₹0 + domain ≈ ₹100/mo equiv. | Highest ops burden and single point of failure; VM can be reclaimed; **not recommended** for a 5–10 h/week solo developer, available only if it passes the gate |
| **S-lite — recommended minimum** | Small VPS + lower-cost managed MongoDB tier with backups (verify availability/price) + free bucket/email/monitoring + domain | ≈ ₹1,500–4,000 | Managed backups remove the riskiest manual job |
| **S — comfortable** | Small VPS + Atlas M10 (PITR options) + bucket + email | ≈ ₹5,000–6,500 | Better metrics, restore options |
| One-time | Legal review (quote pending); domain first year | — | needed before first real student |

Context: even ₹30/student/month × 500 students = ₹15,000/month revenue; infrastructure is a small share. Pricing remains your decision (D-05).

**Status (rev 3): D-26 is DEFERRED. Pilot-school funding is *proposed* under a written agreement but is NOT assumed to exist; Gate G9 stays blocked until it is confirmed. D-28: no spending is authorised now — the domain and the legal review each need separate approval once a pilot and funding are confirmed. Phases 1–7 need no spend (localhost + synthetic data).**

**Funding paths (decision D-26):** (a) pilot agreement where the school covers hosting at cost or pays a subscription from day one *(my recommendation — the school owns the data and benefits)*; (b) you self-fund the minimum; (c) delay go-live while development continues; (d) Tier Z, if and only if verified.

## 7. Backup & disaster recovery plan

| Item | Plan |
|---|---|
| DB | managed snapshots/PITR if the tier has them (verify) **and** independent nightly `mongodump` → gzip → encrypt (age/GPG) → separate-provider bucket; retain 7 daily / 4 weekly / 6 monthly |
| Files | bucket versioning + monthly sync to a second provider |
| Config/secrets | password manager + sealed offline copy; never in Git; documented emergency-access procedure |
| Encryption | at rest (provider) + backup encryption, key stored separately from backups |
| **Restore drill** | scripted `restore-check`: restore latest backup into a scratch DB → counts + `verify-ledger` + sample queries; **required before go-live and then quarterly**; measured RTO/RPO recorded |
| Targets (proposed) | RPO ≤ 24 h (dump-only) / ≤ 1 h (PITR); RTO ≤ 4–8 h (solo, honest) |
| Incident runbook | detect → contain (revoke sessions/keys) → scope via audit logs → notify school(s) → legal-notification review → post-mortem |
| School data export | Owner-triggered per-school export (CSV/JSON zip), automatic on termination |

*A backup counts only after a restore has been demonstrated.*

## 8. Release & rollback

1. Tag → CI builds → staging deploy → smoke + critical-flow E2E → manual approval → production.
2. DB changes: **additive, backward-compatible** migrations (fields/indexes first, code second, cleanup later); versioned scripts in `scripts/migrations`, idempotent, pre-migration backup.
3. Rollback: redeploy previous artefact (keep N versions); destructive DB changes need approval + verified backup (your Rule 27).

## 9. Security baseline for hosting
Firewall (80/443 + SSH key only), SSH keys only, unattended security updates, non-root service user, DB least-privilege users (app user cannot drop DB), IP allow-list where supported, secrets in env not repo, rotation procedure, HTTPS + HSTS, CSP/security headers, Dependabot, MFA on GitHub/host/DB/domain/email accounts.

## 10. Production-Readiness Gate (blocks onboarding of real students)

**Rule:** No real student, guardian, staff or financial data is loaded into *any* environment until **every** item below is ✔ with evidence recorded in `docs/go-live/gate-<date>.md` and signed off by you. Items marked ★ are not waivable. The gate is re-checked (delta only) at each later release that adds a data class (R2 fees, R4 marks).

| # | Gate item | Evidence required |
|---|---|---|
| **G1★ Hosting approved** | Host terms **verified to permit commercial SaaS use**; region/data-residency decided; documented limits (CPU/RAM/storage/bandwidth); written statement of no-SLA expectations given to the school; account owner & recovery set up with MFA | verification-log entries (source URL + date); screenshots/PDF of terms |
| **G2★ Backups & restore** | Automated DB + file backups running; encrypted; off-site on a separate provider; **restore drill passed** with measured RTO/RPO | restore-check output + timings |
| **G3 Monitoring** | Uptime check, error tracking, log retention, disk/DB-size alerts; alert path tested (simulated failure reaches your phone) | test record |
| **G4★ Security controls** | Isolation suites 1–14 and 10 mandatory scenarios green; threat model T1–T27 reviewed; `npm audit` no unresolved high/critical; gitleaks clean; ZAP baseline on staging reviewed; TLS + security headers verified; production secrets unique and rotated; admin/SSH access MFA/keys; platform admin only via CLI/MFA | CI run ids; scan reports |
| **G5★ Legal** | Privacy notice, ToS and school data-processing agreement **reviewed by a qualified professional**; DPDP/children's-data analysis done; consent flows match advice; breach-notification process agreed; no "compliant" marketing claim without sign-off | reviewer's written confirmation |
| **G6 Data readiness** | Migration rehearsed on staging with a **synthetic** file of the school's structure; rollback tested; production DB/credentials separate | rehearsal log |
| **G7 Operations** | Runbooks (deploy, rollback, restore, incident), support contact & hours communicated, rollback rehearsed | docs + rehearsal log |
| **G8★ Financial (only releases with fees)** | Ledger invariants green (property + concurrency); reconciliation job running; parallel-run plan with the school's Excel agreed | test outputs |
| **G9 Funding & sign-off** | Production funding path decided (D-26) and active; your written go decision; pilot school informed of limitations (no SLA, estimated RPO/RTO) | sign-off file |

If a ★ item cannot be met within budget, the answer is **"not yet"**, not a workaround.

## 11. Portability rules (so free dev infrastructure → paid production is a configuration change)

1. **No vendor-specific runtime APIs.** Plain Node 22 server for API and worker; Next.js built with `output: 'standalone'`; no Vercel/Cloudflare-only features (edge runtime, KV, proprietary image service) in core paths.
2. **Database via connection string only.** Standard MongoDB wire protocol and standard Mongoose; **no Atlas-only features** (Atlas Search, Triggers, Data API, Charts). Backups use standard `mongodump/mongorestore` formats.
3. **Adapters for everything external:** `StorageAdapter` (S3-compatible API + local FS), `EmailAdapter` (SMTP/API providers), `PaymentGateway`, `SmsAdapter`. Swapping provider = new env values or a new adapter file, no business-logic change.
4. **Twelve-factor config:** all environment differences in validated env vars; no hard-coded hostnames.
5. **Container-optional:** provide a `Dockerfile` + compose example *and* a documented bare-Node/systemd run path; neither is required to develop.
6. **Same-site by design:** the web app proxies `/api/*`; moving hosts or adding a domain doesn't change cookie behaviour.
7. **Reversible data hosting:** documented export/import path (full-tenant export, `mongodump` of whole DB) so moving provider is a rehearsed procedure, tested once on staging in R1.

## 12. Verification log process (addresses R26)
`docs/verification-log.md` has one row per claim: *provider · claim (e.g. "free tier permits commercial use") · source URL · date verified · verified by · expiry/re-check date (≤ 90 days or before any purchase)*. Every ₹ figure and limit in this document stays **PENDING** until it has a row. G1 and G9 require the rows for everything in the chosen stack.
