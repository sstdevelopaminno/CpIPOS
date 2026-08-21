# POS Buffet Table — Active Session Phase (2026-08-21)

## Baseline

- Base production commit: `933b3b94727f1b7f5100c15bfee9c0f74abbe520`.
- Android / printer / MDM behavior is unchanged.
- No schema or RLS migration is required.
- Existing `table_bill_sessions.metadata` stores the lightweight buffet session summary.

## Goals

1. Reopening an existing Buffet Table must never add a second buffet charge automatically.
2. Staff can see the current buffet count for the table.
3. Adding guests or sets during an open bill is an explicit action.
4. The summary is derived from persisted `order_items`, not from client-side increment events.
5. Normal dine-in payment and table closing remain unchanged.
6. Frequent `/api/pos/tables` polling must not gain an `order_items` query.

## Runtime model

`table_bill_sessions.metadata.buffet_session` contains:

```json
{
  "enabled": true,
  "per_person_quantity": 2,
  "set_quantity": 1,
  "total_quantity": 3,
  "subtotal": 997,
  "updated_at": "<server timestamp>"
}
```

The summary is rebuilt from persisted order items after a successful dine-in order event. Legacy/open sessions without summary are lazily recovered when the Buffet Table picker is opened.

## POS behavior

- New Buffet Table: choose per-person or set plan and enter initial quantity.
- Existing Buffet Table: the modal shows `โต๊ะนี้เปิดบุฟเฟ่แล้ว` with current guests, sets, and buffet subtotal.
- Existing table actions are explicit: `เพิ่มลูกค้า` or `เพิ่มชุด`.
- `เข้าหน้าขายต่อ` closes the modal without changing the bill.
- Adding quantity creates a normal buffet cart line using the branch product's server-resolved price; the existing full dine-in submit flow remains authoritative.
- After the order is persisted, the active table session summary is synchronized from the database.

## Table browser

The table list receives `buffet_summary` from the existing active session metadata and displays a compact badge such as:

- `บุฟเฟ่ 2 ท่าน`
- `บุฟเฟ่ 1 ชุด`
- `บุฟเฟ่ 2 ท่าน · 1 ชุด`

No additional `order_items` query is added to the periodic table list endpoint.

## Safety

- Existing configured buffet product prices remain authoritative.
- No automatic re-price or duplicate package charge.
- No change to payment transaction, kitchen routing, QR expiry policy, printer routing, Android release, or protected Stable stores.
- Session-summary synchronization is scoped by tenant, branch, table/order, and active table session status.
