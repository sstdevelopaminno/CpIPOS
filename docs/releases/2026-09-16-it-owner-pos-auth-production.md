# CpIPOS production release — IT Owner / POS authentication bridge

Release marker for the production deployment of the tenant POS authentication bridge.

Source application code is already merged into `main` at:

- `7c4c7aa7d93b6bc786ed1862cba8a56e0579002c` — Merge PR #173: bridge IT Owner identity and PIN into tenant POS login

Production contract:

- Employee Code remains the first POS login identity.
- Owner/Manager users confirm the 4–6 digit Owner PIN configured by CpIPOS-IT before entering privileged POS/Device flows.
- Identity and PIN authority are read from CpiPOS-001: `pos_user_profiles`, `user_branch_roles`, and `users_profiles.pin_hash`.
- Plaintext PIN and PIN hash are never returned to the browser.
- Existing Staff/Kitchen login behavior remains unchanged.
- No database schema migration is introduced by this release marker.

This documentation-only commit intentionally changes the production branch tree so the Vercel Git integration creates a new production deployment containing the already-merged application code.
