# Known Limitations (kept honest; updated every checkpoint)

## Not production-ready
The system is **not safe for live school data**. The Production-Readiness Gate (docs/phase-0/12 §10) has not been passed: no approved hosting, no backups/restore drill, no monitoring, no legal review, no funding path (D-26/D-28). Use synthetic data only.

## Current functional limits
- Only the kernel is implemented so far (auth, tenancy, RBAC, audit, school settings, staff invitations). See PROGRESS.md for what exists.
- No web UI yet (Phase "Web").
- Email: development outbox only — no real email is sent (no provider authorised). Password-reset and invitation links appear in `apps/api/.data/mail/`.
- Phone-number login is supported by the identity model, but there is no SMS adapter, so phone-only accounts cannot receive reset links.
- Suspended/deactivated schools lose all access (no read-only/export mode until policy D-10 is decided).
- Rate limiting is in-memory (one API process). Behind several processes/hosts a shared store is required.
- MFA, custom-role UI, session "remember this device" refinements: not implemented.
- Subscription plans/entitlements: only per-school `limits.students` / `limits.staff` set by CLI.

## Environment
- Tests use `mongodb-memory-server` (downloads ~590 MB of `mongod` on first run). Pinned `MONGOMS_VERSION` must match the production MongoDB major version once hosting is chosen.
