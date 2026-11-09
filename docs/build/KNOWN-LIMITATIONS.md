# Known Limitations (kept honest; updated every checkpoint)

## Not production-ready
The system is **not safe for live school data**. The Production-Readiness Gate (docs/phase-0/12 §10) has not been passed: no approved hosting, no backups/restore drill, no monitoring, no legal review, no funding path (D-26/D-28). Use synthetic data only.

## Current functional limits
- See PROGRESS.md for what exists. Web UI covers auth, shell, dashboard, students list and attendance only.
- Email: development outbox only — no real email is sent (no provider authorised). Password-reset and invitation links appear in `apps/api/.data/mail/`.
- Phone-number login is supported by the identity model, but there is no SMS adapter, so phone-only accounts cannot receive reset links.
- Suspended/deactivated schools lose all access (no read-only/export mode until policy D-10 is decided).
- Rate limiting is in-memory (one API process). Behind several processes/hosts a shared store is required.
- MFA, custom-role UI, session "remember this device" refinements: not implemented.
- Subscription plans/entitlements: only per-school `limits.students` / `limits.staff` set by CLI.

## Import / export (checkpoint 4)
- **CSV only.** XLSX files must be saved as CSV first (no XLSX parser adopted yet — the SheetJS npm package has a licensing/advisory history, doc 04). Dates are read in the order chosen on the mapping screen (DMY default); 2-digit years are rejected.
- Import is **synchronous and capped at 2,000 rows / ~3 MB per file** (doc 15). Larger schools split the file. No background job queue until R3 (ADR-5).
- Students only (with enrolment + one guardian per row). Staff and class-structure imports are not built.
- Rollback deletes only records nobody has touched since the commit (edited, attendance marked, status changed, re-enrolled, guardian links changed). **Before fees go live (R2) the rollback "touched" checks must also include invoices/payments.**
- Guardians are re-used when phone AND name match (case-insensitive); a guardian with the same phone but a differently spelled name becomes a new guardian record.
- Student CSV export is capped at 20,000 rows per request; exports include only the first active guardian.

## Environment
- Tests use `mongodb-memory-server` (downloads ~590 MB of `mongod` on first run). Pinned `MONGOMS_VERSION` must match the production MongoDB major version once hosting is chosen.
