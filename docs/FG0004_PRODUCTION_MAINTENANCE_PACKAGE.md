# FG0004 Production Maintenance Package

Mode: dry-run only. Do not execute production changes from this phase.
Date: 2026-08-24
Branch: `prep/fg0004-restaurant-qr-provisioning`
Verified source base SHA: `f373ce7349664a7417521d8876430f8fd66793d3`


## SHA-256 Lock

- `088AFEFB9D91E74D45D54006F947A071CD5AF9E155DAFF5FF0729CF298A6636C` `supabase/migrations/202608240001_fg0003_qr_pos_review_lifecycle.sql`
- `3BBBDAFA97E0FFD6300FB49C0C8332142631ACE95C700A5976D5D157CC37927F` `supabase/migrations/202608240002_fg0003_cancelled_order_print_claim_guard.sql`
- `0793DD12F99EED1954D6856000B0E076B410CBAC99B057D4E0D86770B009F9A9` `supabase/provisioning/fg0004_primary_inactive_restaurant_qr_provisioning.sql`
- `1C5450A5D4356196373CAF844A081BD30C55BC0EC8F9FD049ED661F368516602` `supabase/maintenance/fg0004_primary_collision_preflight_readonly.sql`
- `06E073A1392E370C360C25C017344C418F7436263CC44CAAA9DAE2BBB2516114` `supabase/maintenance/fg0004_primary_maintenance_gate_readonly.sql`
- `CCA3C95F18AC125F3C2F0B170F9E7CF500374238D84F986D5DFA26AC23682296` `supabase/maintenance/fg0004_primary_inactive_postflight_readonly.sql`
- `5A018F74EBE764F9A7D691A19F41C756FBE7BCF370BC49ED65608CB7D08989D0` `supabase/maintenance/fg0004_primary_containment_disable.sql`
## Current Gate

Read-only Primary check showed the maintenance gate is closed:

- active POS sessions: 2
- open shifts: 2
- unpaid open orders: 0
- active table bills: 0
- active print jobs: 0
- device heartbeat: known
- print agent heartbeat: known

Do not force these values to zero. Wait for normal store closure.

## Production Changeset

Exact SQL files for a future approved maintenance window:

1. Schema/additive Restaurant QR lifecycle: `supabase/migrations/202608240001_fg0003_qr_pos_review_lifecycle.sql`
2. Restaurant QR registry and FG0003 backward-compatible seed: `supabase/migrations/202608240002_fg0003_cancelled_order_print_claim_guard.sql`
3. Cancelled-order print claim guard: same file as item 2
4. FG0004 Primary inactive provisioning: `supabase/provisioning/fg0004_primary_inactive_restaurant_qr_provisioning.sql`

Read-only support scripts:

- `supabase/maintenance/fg0004_primary_collision_preflight_readonly.sql`
- `supabase/maintenance/fg0004_primary_maintenance_gate_readonly.sql`
- `supabase/maintenance/fg0004_primary_inactive_postflight_readonly.sql`

Containment script, source-only:

- `supabase/maintenance/fg0004_primary_containment_disable.sql`

## Execution Order

1. Re-run `fg0004_primary_maintenance_gate_readonly.sql`; stop unless the gate is open.
2. Capture Primary backup/recovery point evidence.
3. Run `fg0004_primary_collision_preflight_readonly.sql`; stop on any FG0004 collision.
4. Apply Restaurant QR Standard lifecycle only if not already present by preflight/name audit.
5. Apply registry/print-guard migration.
6. Verify FG0003 registry: `RESTAURANT_QR`, `enabled=true`, `status=enabled`.
7. Run targeted FG0003 non-financial smoke checks.
8. Run `fg0004_primary_inactive_restaurant_qr_provisioning.sql` only once.
9. Run `fg0004_primary_inactive_postflight_readonly.sql`.
10. Read-only verify FG0003 unchanged.
11. Stop. Do not activate FG0004 QR.

## Safety Notes

- No destructive DROP.
- No wildcard FG activation.
- FG0004 registry remains `enabled=false/status=provisioning`.
- FG0003 registry seed remains explicit and backward-compatible.
- Shared Restaurant QR infrastructure must not be destructively rolled back while FG0003 depends on it.
- No fake payments and no test print unless separately authorized.

## FG0004 Inactive Manifest

- Store: `FG0004`, `เลิศรส 108 เมนู`
- Branch: `FG0004-RBR-01`, `เลิศรส 108 เมนู ราชบุรี`
- Package: Growth
- Profile: `RESTAURANT_QR`
- Tables: `T01`-`T20`
- POS: `FG0004-POS-01`, single display, inactive
- Printer slots: `RECEIPT-01`, `KITCHEN-01`, disabled
- Roles: OWNER, STAFF, KITCHEN
- Opening: TBD
- Runtime QR: disabled

## FG0003 Smoke Plan

Read-only or non-financial checks only:

- store/login resolution
- QR endpoint reachable
- pending popup query works
- Print Agent heartbeat
- print queue count
- device heartbeat
- no 5xx surge

## Monitor Window

After eventual migration, monitor before any FG0004 activation:

- QR failures
- popup backlog
- print queue
- print claim timeout
- 5xx
- POS heartbeat
- Print Agent heartbeat