# CpIPOS IT Admin Web

Independent IT Control Plane deployment.

## Vercel

- Project: `cp-ipos-it-admin-web`
- Root Directory: `apps/it-admin-web`
- Production Branch: `it-admin/main`
- Install: `npm install --no-audit --no-fund`
- Build: `npm run build`
- Production project settings verified on 2026-08-25; deploy fresh commits from `it-admin/main` and do not rebuild the legacy POS deployment.

## Runtime boundary

This app intentionally does not expose POS, table-order, payment, receipt, Print Agent or customer-display runtime routes.

Current routes:

- `/it-admin-login`
- `/it-admin`
- `/it-admin/operations`
- `/it-admin/stores`
- `/it-admin/mdm`
- `/it-admin/incidents`
- `/api/auth/login`
- `/api/auth/logout`

## Environment

Only the primary Supabase auth/data plane variables are required. POS signing, QR signing, payment, print bridge and Android updater secrets must not be copied into this project unless a future isolated IT capability explicitly requires one.

## Safety

- UI changes here do not require a `cp-ipos-web` production deployment.
- MDM is read-only in the first separated release.
- Future device commands must remain `Store -> Branch -> Device` scoped, preview target count, require confirmation and write an audit log.
- Store provisioning will be transactional and create stores as `PROVISIONING/INACTIVE` before activation.
