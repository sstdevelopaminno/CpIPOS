# POS Buffet Table Mode UI Wire Contract

## Goal

Prepare the POS sales screen for the new **โต๊ะบุฟเฟ่** quick mode with a small, low-risk change set before editing the large `pos-sales-module.tsx` production file.

## Added in this phase

- Adds `buffet_table` to `POS_MODE_FEATURES`, mapped to the existing `table_management` feature gate.
- Adds `buffet-table-mode-option.ts` as the quick-mode UI copy/contract.
- Keeps the existing dine-in and delivery behavior untouched.

## Intended POS flow

1. Cashier selects **โต๊ะบุฟเฟ่** from the sales mode selector.
2. POS uses the same table browser as dine-in mode.
3. Cashier selects or opens a table.
4. POS opens `PosBuffetPricePickerModal`.
5. Cashier selects either a per-person plan or a set plan.
6. Cashier enters quantity.
7. Confirming appends a buffet cart line using the existing buffet adapter.
8. The remaining table bill, payment, receipt, and drawer flows continue through the existing dine-in flow.

## Next patch into `pos-sales-module.tsx`

The next patch should be intentionally small:

- Extend `QuickMode` to include `buffet_table`.
- Import `PosBuffetPricePickerModal`.
- Import `confirmBuffetPricePlan` and `appendBuffetCartItem` from `buffet-table-flow`.
- Import `getBuffetTableModeCopy` and `isBuffetTableQuickMode` from `buffet-table-mode-option`.
- Treat `buffet_table` as table mode for the table browser.
- Show the buffet picker after table open/select.
- Append the selected buffet price line into `cart`.

## Safety notes

- This phase does not change Windows Runtime.
- This phase does not change checkout/payment behavior.
- This phase does not change table QR ordering.
- This phase does not introduce new database schema yet.

The future backoffice phase will add **เพิ่มเติม > จัดการราคาบุฟเฟ่** for real CRUD of buffet price plans.
