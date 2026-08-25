# CpIPOS Product & Store Registry

Last updated: 2026-08-25 (Asia/Bangkok)

This document is the canonical product/store registry for the Buffet deployment lane. Store behavior must remain configuration-driven; do not fork application code per store.

## Global rules

- Supabase Primary: `CpiPOS-001` (`deejlitaivfnsbwqdugy`)
- Android package: `com.cpipos.pos`
- Current Modern Android runtime: `1.0.20` / `versionCode 28`
- Android runtime is shared across Restaurant QR and Buffet.
- Tenant and branch isolation are mandatory.
- Billing dates, package status, feature unlocks, function toggles, grace/lock policy, and other commercial controls are owned by the IT Control Plane.
- Printer assignment is explicit-first. Never create fake physical hardware identities.

## Restaurant QR / Table Ordering

- Product profile: `RESTAURANT_QR`
- Store prefix: `FG####`
- Production Vercel project: `cp-ipos-web`
- Feature development: frozen except operational/security fixes unless explicitly reopened.

### FG0003

- Package: `Growth`
- Status: `ACTIVE / PRODUCTION_PROTECTED`
- Android: shared `1.0.20 / code28` target

### FG0004 — เลิศรส 108 เมนู

- Store code: `FG0004`
- Branch: `FG0004-RBR-01` — เลิศรส 108 เมนู ราชบุรี
- Package: `Growth` — THB 550/month
- Status: `SETUP_TRIAL / ACTIVE_FOR_CONFIGURATION`
- Tables: `20`
- POS: `1` (`FG0004-POS-01`)
- CpIPOS IT access: employee code `253618`, branch role `manager`
- Restaurant baseline features enabled: `core_pos_sales`, `attendance_tracking`, `table_management`, `kitchen_printing`, `qr_table_ordering`

## Buffet

- Product profile: `BUFFET`
- Store prefix: `FF####`
- Git lane: `buffet/main`
- Intended Vercel project: `cp-ipos-buffet-web`
- Vercel project status as of this update: `NOT CREATED / NOT VISIBLE`
- Interim testing: use isolated Preview deployment from `buffet/main` until the dedicated Vercel project exists.
- Shared baseline with Restaurant QR: login, POS sales, shift, payment, tables, orders, users, MDM, printer runtime, customer display, and core UI.
- Buffet extensions: party size, package/price, dining timer, last-order rules, buffet session state, and buffet-only controls.

### FF0001 — มาลองนัว

- Store code: `FF0001`
- Public/customer access code: `185417`
- Store name: `มาลองนัว`
- Branch code: `FF0001-AYU-01`
- Branch name: `มาลองนัว อยุธยา`
- Province: `อยุธยา`
- Product profile: `BUFFET`
- Package: `Growth` — THB 550/month
- Contract state: `trial`
- Billing started: `false`
- Auto renew: `false`
- Commercial activation: pending IT confirmation
- Current state: `SETUP_TRIAL / ACTIVE_FOR_CONFIGURATION`
- Tables: `20/20 active`, `T01-T20`
- POS devices: `2/2 active`
  - `FF0001-POS-01`
  - `FF0001-POS-02`
- POS display mode: `single_screen`
- Minimum Android runtime: `1.0.20 / versionCode 28`
- CpIPOS IT access: employee code `253618`, branch role `manager`, platform role `it_admin`
- Login policy: employee/PIN enabled, registered-device requirement disabled during setup, maximum 2 POS devices
- Buffet baseline features enabled: `core_pos_sales`, `attendance_tracking`, `table_management`, `kitchen_printing`, `qr_table_ordering`
- Receipt printers requested: `2`; physical hardware binding pending
- Kitchen printer count/transport: `TBD` (`USB / Bluetooth / LAN`)
- Opening date/time: `TBD`
- Physical printer records: not created until hardware identity is known

## Activation policy

During SETUP_TRIAL, the store may be configured and smoke-tested. Billing Cycle, payment request, subscription expiry, auto-lock date, and commercial activation are intentionally not created until IT defines them.

Before customer handoff:

1. Dedicated Buffet Vercel project is verified.
2. Owner account is created; temporary IT access remains controlled by IT.
3. Buffet package/price/timer/last-order policy is configured.
4. Physical POS and printer hardware are explicitly bound.
5. Payment, receipt, kitchen print, table session, QR ordering, and close-table smoke tests pass.
6. IT sets billing start, billing cycle, expiry/lock policy, and commercial status.
