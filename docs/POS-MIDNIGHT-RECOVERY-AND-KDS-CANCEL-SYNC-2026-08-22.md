# POS Midnight Recovery and KDS Cancel Sync - 2026-08-22

## Scope

This checkpoint hardens dine-in table bills when Kitchen cancels an accepted line and adds a daily recovery guard for stale POS table/bill shells.

## KDS cancel -> POS bill sync

- `GET /api/pos/tables/[tableId]/bill` supports `refresh=1` to bypass the in-memory route cache and refresh the stable cache key.
- The table bill payload now includes `order_items.metadata` so POS can see `metadata.bill_line_state = cancelled`.
- POS maps only active positive-quantity lines into the cart.
- POS tracks server-cancelled line keys and refuses to merge matching local draft rows back into the cart.
- While a dine-in table is open, POS refreshes that single active table bill every 3.5 seconds and on focus. The table browser prefetch path remains lite/cached to avoid a branch-wide polling storm.

## Daily midnight recovery

Migration `20260822033000_pos_midnight_recovery.sql` creates `app.run_midnight_pos_recovery()` and schedules it at `0 17 * * *`, which is 00:00 Asia/Bangkok.

The recovery is intentionally non-destructive:

- It cancels stale active table sessions with no linked order.
- It cancels stale linked dine-in orders only when they have no payments and no active positive-quantity order items.
- It releases affected tables only after no active table bill session remains.
- It marks stale sessions that still have payments or active items as `daily_midnight_recovery_review_required` instead of cancelling them.
- It does not delete `orders`, `order_items`, `payments`, or `table_bill_sessions`.

## Data-plane note

The same migration is mirrored under `supabase/trial-data-plane/migrations`. Apply only through the normal Primary/Trial migration release process. Do not run live DB changes from Codex without explicit authorization.

## MDM note

`MDM_RELOAD_GENERATION_MS` was bumped for this deploy so installed Android POS devices can reload the WebView once after deployment. Android update policy still returns no install offer when the Modern runtime is already on version 1.0.20 or newer.