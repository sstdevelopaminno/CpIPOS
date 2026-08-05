# POS Buffet Table Mode Wire Adapter

## Goal

Prepare the safe wiring contract for a new POS quick mode named `buffet_table` before touching the large `pos-sales-module.tsx` file.

The target UX is:

1. Cashier selects **โต๊ะบุฟเฟ่** in the POS sales screen.
2. POS reuses the existing dine-in table browser.
3. Cashier selects or opens a table.
4. POS opens the buffet price picker modal.
5. Cashier selects either a per-person buffet plan or a set buffet plan.
6. Cashier enters quantity.
7. Confirming the modal appends a buffet cart line to the same cart used by dine-in mode.
8. After that, table bill, cart, discount, payment, receipt, and drawer flows remain the same as dine-in.

## Added adapter

`apps/backoffice-web/src/components/pos/features/buffet-table-flow.ts`

This adapter provides:

- `buildBuffetTableModeState(table)`
- `shouldPromptBuffetPricePicker(...)`
- `createOpenBuffetTableResult(table, plans)`
- `confirmBuffetPricePlan(...)`
- `appendBuffetCartItem(...)`

## Why this PR is separated

`pos-sales-module.tsx` is the core POS sales module and currently contains multiple production flows: takeaway, dine-in, delivery, table QR, payment, receipt, cash drawer, held bills, pending queues, and offline catalog snapshots.

This PR keeps the typed buffet flow isolated so CI can verify the pricing/cart contract first. The next PR should wire the adapter into `pos-sales-module.tsx` with a small, reviewable patch.

## Next PR checklist

- Extend `QuickMode` to include `buffet_table`.
- Add Thai/English labels for the new mode.
- Add a mode card/button for **โต๊ะบุฟเฟ่**.
- Reuse the existing table browser for buffet mode.
- After `openBillForTable` succeeds in buffet mode, open `PosBuffetPricePickerModal`.
- Append the confirmed buffet cart line with `appendBuffetCartItem`.
- Keep the rest of the dine-in table flow unchanged.

## Future backoffice phase

After the POS flow works with defaults, add:

- `เพิ่มเติม > จัดการราคาบุฟเฟ่`
- CRUD for buffet price plans
- per-branch active/inactive plans
- audit log for buffet pricing changes
- optional plan image/description/time rules
