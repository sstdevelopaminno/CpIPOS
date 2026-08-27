# CpIPOS Product & Store Registry

Last updated: 2026-08-25 (Asia/Bangkok)

This document is the canonical product/store deployment registry for CpIPOS. It records which store family belongs to which product profile and Vercel project. Store-specific behavior must be configuration-driven; do not fork application code per store.

## Global rules

- Supabase Primary: `CpiPOS-001` (`deejlitaivfnsbwqdugy`)
- Android package: `com.cpipos.pos`
- Current Modern Android runtime: `1.0.22` / `versionCode 30`
- Android runtime is shared across Restaurant QR and Buffet unless native hardware requirements materially diverge.
- Tenant and branch isolation remain mandatory for every product profile.
- MDM commands must be scoped `store -> branch -> exact device`; global broadcast is not the default.
- Printer assignment is explicit-first. Never create fake physical hardware identities.

## Product family: Restaurant QR / Table Ordering

- Product profile: `RESTAURANT_QR`
- Store prefix: `FG####`
- Vercel project: `cp-ipos-web`
- Deployment mode: `CENTRAL`
- Shared baseline: same login, POS sales, shift, payment, table management, QR review popup, kitchen routing, receipt printing, MDM, user management, and core UI.
- New FG stores must reuse this baseline. Do not create a permanent code fork per FG store.
- Restaurant QR feature development is currently frozen; only operational fixes/security fixes should be considered unless explicitly re-opened.

### FG0003

- Store code: `FG0003`
- Store name: `TheTreeจิ้มจุ่ม99`
- Branch code: `FG0003-BKK-01`
- Branch name: `สาขาหลัก`
- Package: `Growth`
- Registry: `RESTAURANT_QR`
- Update ring: `PRODUCTION_PROTECTED`
- Status: `ACTIVE`
- Notes: protected production store. Changes must be isolated and verified before rollout.

### FG0004

- Store code: `FG0004`
- Store name: `เลิศรส 108 เมนู`
- Branch code: `FG0004-RBR-01`
- Branch name: `เลิศรส 108 เมนู ราชบุรี`
- Province: `ราชบุรี`
- Package: `Growth`
- Tables: `20` (`T01-T20`)
- POS devices: `1` (`FG0004-POS-01`)
- Display mode: `single_screen`
- Printer slots: `RECEIPT-01`, `KITCHEN-01` (physical hardware must be explicitly bound before use)
- Registry: `RESTAURANT_QR`
- Update ring: `PILOT`
- Status: `ACTIVE`
- Bootstrap employee code: `253618` (temporary owner/bootstrap identity; disable or replace after the real owner account is established)

## Product family: Buffet

- Product profile: `BUFFET`
- Store prefix: `FF####`
- Git production lane: `buffet/main`
- Vercel project: `cp-ipos-buffet-web` — **NOT CREATED / NOT VISIBLE IN VERCEL AS OF 2026-08-25**
- Deployment mode: `CENTRAL`
- Shared baseline with Restaurant QR: login, tenant/branch scope, POS sales, shift, payment, table management, order flow, user management, MDM, printer runtime, customer display, and core UI.
- UI direction: same baseline UI as Restaurant QR. Buffet-only changes should be minimal and isolated.
- Buffet-specific rules may extend the shared baseline for party size, buffet package/price, dining timer, last-order rules, session state, and other buffet-only controls.
- Do not register `FF####` stores in `app.restaurant_qr_store_registry`.

### FF0001 — มาลองนัว

- Store code: `FF0001`
- Public/customer access code: `185417`
- Store name: `มาลองนัว`
- Branch code: `FF0001-AYU-01`
- Branch name: `มาลองนัว อยุธยา`
- Province: `อยุธยา`
- Package: `Growth`
- Tables: `20` (`T01-T20`)
- POS devices: `2`
  - `FF0001-POS-01`
  - `FF0001-POS-02`
- Display mode: `single_screen` for both POS devices
- Android requirement: `CpIPOS 1.0.22 / versionCode 30` or newer approved runtime
- Receipt printer slots: `2`
  - `RECEIPT-01`
  - `RECEIPT-02`
- Kitchen printer count/transport: `TBD` (`USB / Bluetooth / LAN` must be confirmed before hardware binding)
- Opening date/time: `TBD`
- Current DB state: `PROVISIONING / INACTIVE`
- Tenant active: `false`
- Branch active: `false`
- Tables active: `0/20`
- POS devices: `inactive + locked`
- Receipt printer slots: `disabled`, hardware identity `TBD`
- Restaurant QR registry rows: `0` (intentional)
- Owner/bootstrap login: `NOT CREATED YET`
- Buffet policy/session configuration: `PENDING`
- Vercel Buffet production project: `PENDING`

## Activation checklist for a new store

A store must not be marked live until all required items are complete:

1. Product profile and store prefix verified.
2. Correct Vercel project/deployment lane verified.
3. Tenant, branch, package, table count, and POS device count read back from Primary.
4. Android install(s) paired to exact branch device(s).
5. Printer hardware explicitly identified and bound; no placeholder hardware is enabled.
6. Owner/bootstrap access created through approved credential flow.
7. Branch login policy verified.
8. Required product-specific policy configured (Restaurant QR or Buffet).
9. Non-financial smoke test passes.
10. Payment/receipt/kitchen printing tests pass before customer handoff.
11. Postflight read-back confirms only the target store changed.
