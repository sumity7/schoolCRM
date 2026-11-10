# Backup, Restore & School Data Portability — Runbook

Audience: the operator (you) running EduNex on a server. Synthetic data only until the Production-Readiness Gate
(doc 12 §10) passes. **A backup counts only after a restore has been demonstrated** (doc 12 §7).

## 1. What exists

| Tool | Command (`cd apps/api`) | What it does |
|---|---|---|
| Whole-database backup | `npm run cli -- backup --dir /var/backups/edunex --prune` | Encrypted backup of every collection; `--prune` keeps 7 daily / 4 weekly / 6 monthly |
| Restore drill | `npm run cli -- restore-drill --file F` | Restores into a scratch database, verifies digests, runs sanity checks, drops it, writes a JSON report with backup age (RPO) and restore time (RTO data part). Exit code 2 on failure |
| Restore | `npm run cli -- restore --file F --target-db edunex_restored` | Restores into a **new, empty** database; refuses non-empty targets and the database the CLI is connected to |
| School export | `npm run cli -- export-school --code demo --out demo.edxbak` | One school's data; **no password hashes / MFA secrets** |
| School purge | `npm run cli -- deactivate-school --code demo` then `npm run cli -- purge-school --code demo --confirm demo --export-file demo.edxbak` | **Irreversible.** Requires deactivated status, the code typed again and a readable export of that school |
| School restore | `npm run cli -- restore-school --file demo.edxbak` | Loads an export where that school does not exist; restored people use "Forgot password" |
| Rehearsal | `npx tsx scripts/backup-rehearsal.ts` | Throw-away replica set + synthetic schools; drives all of the above through the real CLI and records timings in `.data/rehearsals/` |

The passphrase is read **only** from the environment variable `BACKUP_PASSPHRASE` (≥ 16 characters), never from the command line
(shell history). Store it in a password manager **and** separately from the backups. Losing it makes every backup unreadable.

## 2. File format (`.edxbak`)

```
"EDXBAK01" | salt(16) | iv(12) | AES-256-GCM( gzip( NDJSON ) ) | tag(16)      key = scrypt(passphrase, salt, N=2^15, r=8, p=1)
NDJSON lines: {"type":"header",…} → per collection {"type":"collection","name","indexes"} + {"type":"doc","c","d":<canonical EJSON>} → {"type":"footer","counts","sha256"}
```
Open format: decrypt with any AES-GCM implementation, gunzip, parse with any MongoDB Extended-JSON library. Restores
decrypt and check the **whole** file before writing anything; tampering, truncation or a wrong passphrase writes nothing.
After loading, each collection's SHA-256 (over canonical EJSON in `_id` order) is recomputed from the database and must
equal the footer. Backups read from a snapshot session where the server supports it (header `snapshot: true`).

## 3. Schedule (target for the pilot server)

1. Nightly 02:30 IST (cron / systemd timer): `BACKUP_PASSPHRASE=… npm run cli -- backup --dir /var/backups/edunex --prune`.
2. Copy the new file to off-site storage on a **different provider** (e.g. `rclone copy`), keep the same retention there.
3. Weekly: `restore-drill` against the newest file **from the off-site copy**; keep the JSON reports (Gate G2 evidence).
4. Quarterly and before go-live: full `restore` into a new database, point a staging app at it, log in, check counts.
5. If the managed database tier offers snapshots/PITR, keep them on as well — independent copies.

Targets (doc 12 §7, proposed): RPO ≤ 24 h with nightly dumps; RTO ≤ 4–8 h (solo operator).

## 4. Disaster restore (whole database)
1. Stop the API (maintenance page). 2. `restore --file <latest verified> --target-db edunex_restore_YYYYMMDD`.
3. Check the drill output / counts. 4. Point `DATABASE_URL` at the restored database, start the API, log in as a test owner.
5. Record actual RPO/RTO in the incident log. Never restore over the live database in place.

## 5. School leaves (termination)
1. `deactivate-school` (access stops). 2. `export-school` — hand the file + passphrase to the owner through a secure channel
   (owner-facing CSV bundle is not built yet; see KNOWN-LIMITATIONS). 3. After the agreed retention period: `purge-school`.
   The purge removes the school's tenant data, its audit trail, sessions/invites, and user accounts that belonged only to that
   school; it leaves a platform audit entry `platform.school_purged`. Backups taken earlier still contain the school until they
   age out of retention — tell the school this.

## 6. Evidence
- Automated tests: `apps/api/test/backup.test.ts` (round trip, tamper/truncation/wrong passphrase, no overwrite, drill,
  retention, export→purge→restore with the other school byte-identical and password reset afterwards).
- Rehearsal reports: `apps/api/.data/rehearsals/` (see TEST-REPORT.md for the recorded run).
- Not yet done: a drill on the real production host and off-site provider (requires hosting — D-26/D-28).
