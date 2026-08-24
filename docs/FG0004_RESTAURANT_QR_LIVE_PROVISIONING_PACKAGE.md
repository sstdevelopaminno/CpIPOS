# FG0004 Restaurant QR Live Provisioning Package

Status: READY for source review only. Do not deploy, apply migrations, insert FG0004, activate QR, generate customer QR codes, create users, enroll MDM, assign printers, or modify FG0003 in this phase.

## Release Base

- Restaurant QR Standard: `2b83beed145957f306749c5fd9c71df446a24844`
- FG0004 provisioning prep: `629b240ed6cfed1255c15a1920646523dcd2f94d`
- Current package branch must contain both commits cleanly.

## Migration Readiness

Primary source migration: `supabase/migrations/202608240002_fg0003_cancelled_order_print_claim_guard.sql`

The migration remains additive and source-only. It creates `app.restaurant_qr_store_registry`, seeds FG0003 explicitly as `enabled=true/status=enabled`, and keeps all other stores disabled unless they receive an explicit registry row. The Restaurant QR scope function now requires both `enabled=true` and `status='enabled'`, so FG0004 can be staged as `enabled=false/status=provisioning` without customer QR traffic.

No wildcard FG prefix enablement is allowed. `FG####` is a naming convention only.

## FG0004 Inactive Provisioning Plan

- Tenant code: `FG0004`
- Tenant name: `เลิศรส 108 เมนู`
- Package: `growth` / Growth
- Initial tenant state: inactive/provisioning
- Branch code: `FG0004-RBR-01`
- Branch name: `เลิศรส 108 เมนู ราชบุรี`
- Province: `ราชบุรี`
- Tables: `T01` through `T20`, created with fresh IDs and disabled until activation
- POS skeleton: `FG0004-POS-01`, single screen, inactive, shared Android package `com.cpipos.pos`, code 28 or later
- Printer slots: `RECEIPT-01`, `KITCHEN-01`; no hardware identity, printer device, or assignment until physical onboarding
- Role model: OWNER, STAFF, KITCHEN; no accounts, PINs, phones, emails, or passwords are invented

Source-only transaction: `supabase/provisioning/fg0004_inactive_restaurant_qr_provisioning.sql`

## Growth Feature Gate Check

Growth currently includes `core_pos_sales` and `receipt_reprint_history` in the default catalog. Required Restaurant QR capabilities not exposed by Growth defaults:

- `table_management`
- `qr_table_ordering`
- `kitchen_printing`

Do not bypass subscription gates. Package/contract confirmation is required before activation.

## Execution Order

1. Apply `supabase/migrations/202608240001_fg0003_qr_pos_review_lifecycle.sql` if it is not already applied.
2. Apply `supabase/migrations/202608240002_fg0003_cancelled_order_print_claim_guard.sql` during an approved maintenance window.
3. After explicit live provisioning approval only, run `supabase/provisioning/fg0004_inactive_restaurant_qr_provisioning.sql`.
4. Activate customer-facing QR in a later go-live phase only after package, hardware, users, printers, and QR generation are confirmed.

## Rollback Plan

- Preflight failure: transaction raises and rolls back automatically.
- Insert/postflight failure: transaction raises and rolls back automatically.
- After committed inactive provisioning, rollback before activation must delete FG0004 rows in reverse dependency order only.
- Never modify FG0003 as part of FG0004 rollback.

## Missing Physical Inputs

- Opening date/time
- POS hardware model
- Receipt printer type/model
- Kitchen printer type/model
- Printer transport: USB/Bluetooth/LAN
- Printer fingerprint/MAC/USB VID PID/LAN IP
- Owner/operator account details
- Payment methods