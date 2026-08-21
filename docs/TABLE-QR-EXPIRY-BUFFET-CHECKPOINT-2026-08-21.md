# Table QR Expiry + Buffet Continuation Checkpoint — 2026-08-21

## Scope

This checkpoint continues from production commit `303e36e18489525054bf46ab022f55c3c1b9e40b` after the print/Kitchen latency fix passed physical verification.

## Table QR policy

- Adds a Settings submenu: `ตั้งค่า QR โต๊ะ`.
- Management is restricted to owner/manager branch scope through the existing `tables:manage` permission and branch-management guard.
- Each table can use one of two policies:
  - `time`: expiry in minutes/hours, bounded to 15 minutes–24 hours.
  - `bill`: valid while the table bill session is open, with a 7-day hard safety cap for stale-session protection.
- Existing tables without explicit metadata preserve the legacy 18-hour QR lifetime.
- Policy is stored in `dining_tables.metadata.qr_policy`; no schema/RLS migration is required.
- Changing a policy revokes active QR sessions for that table, so the next QR is issued under the new policy.

## Customer timed countdown

- Customer Table QR receives a server-clock-synchronized countdown.
- Countdown updates every second.
- Final 30 minutes use a warning presentation; final 5 minutes use a critical presentation.
- At `00:00`, a full-screen interaction guard blocks the customer ordering surface and instructs the customer to pay/contact staff.
- Server-side enforcement remains authoritative: public Table QR reads/writes still resolve the signed QR session and reject requests after `expires_at`, so bypassing the UI does not permit new orders.
- Bill-lifecycle mode does not show the time countdown and closes with the table bill/session.

## Data-plane compatibility

Read-only schema audit on both CpiPOS-001 and CpiPOS-002 confirmed the required existing fields:

- `dining_tables.metadata` (`jsonb`)
- `table_qr_sessions.status`, `expires_at`, `revoked_at`, `created_at`, `updated_at`
- `table_bill_sessions.status`, `closed_at`, `order_id`, `metadata`, `created_at`, `updated_at`

No database migration is part of this checkpoint.

## POS Buffet Table continuation

The production source already contains the Buffet Table foundation and front-sale wiring:

- `buffet_table` quick mode
- Buffet Table mode button
- dine-in table browser reuse
- buffet price picker
- per-person/set quantity entry
- buffet-product resolver before adding the cart item
- mode preservation across table/payment flows

Do not re-merge historical buffet branches wholesale. Continue from the current production implementation and close only concrete remaining UX/transaction regressions after the Table QR checkpoint is green.
