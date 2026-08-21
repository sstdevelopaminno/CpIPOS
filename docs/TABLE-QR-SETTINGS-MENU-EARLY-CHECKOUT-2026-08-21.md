# Table QR Settings Menu + Early Checkout Adjustment — 2026-08-21

## Scope

Small follow-up after Table QR timed/bill expiry rollout.

## Settings UI

- Remove the special Table QR banner above the Settings workspace.
- Keep Table QR settings visible only to Owner/Manager.
- Render `ตั้งค่า QR โต๊ะ` as a normal Settings submenu card immediately after `จอลูกค้า / Customer Display`.
- Preserve the existing `/preview/pos/settings/table-qr` route and permissions.

## Timed QR + early checkout

Timed mode is a maximum ordering window, not a minimum dining duration.

- Customers can request checkout before the countdown reaches zero.
- POS payment/payment-lock flow does not depend on `expires_at` and therefore remains free to settle the bill early.
- When the bill/session is closed before the configured QR expiry, the public QR is closed by the normal table-bill lifecycle.
- Customer UI distinguishes `bill closed/paid` from a true timer expiry so an early settlement does not incorrectly display `หมดเวลาสั่งอาหาร`.
- Actual timer expiry still locks the customer ordering surface and public writes remain server-authoritative.

## Safety

- No schema or RLS migration.
- No change to table-order transaction RPC.
- No change to payment transaction semantics.
- No printer, MDM, Android, or protected Stable-store behavior change.
