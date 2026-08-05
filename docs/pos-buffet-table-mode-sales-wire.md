# POS Buffet Table Mode Sales Wire Helpers

## Goal

Prepare the final safe wiring helpers before editing `pos-sales-module.tsx` directly.

The intended production behavior is:

1. Cashier selects **โต๊ะบุฟเฟ่** from the POS sales mode selector.
2. POS treats the mode as table/dine-in for table selection and bill lifecycle.
3. Cashier selects or opens a table using the existing table browser.
4. POS opens the buffet price picker for that table once.
5. Cashier chooses a per-person or set buffet package and enters quantity.
6. Confirming the picker appends the buffet line into the existing cart.
7. Cart, discount, payment, receipt, drawer, table move, and QR table actions continue through the existing dine-in flow.

## Added helper

`apps/backoffice-web/src/components/pos/features/buffet-table-sales-wire.ts`

Exports:

- `PosSalesQuickModeWithBuffet`
- `isBuffetTableMode(mode)`
- `isTableSalesMode(mode)`
- `orderTypeForQuickMode(mode)`
- `shouldShowTableBrowserForMode(...)`
- `buildOpenBuffetPickerState(...)`
- `closeBuffetPickerState(...)`
- `confirmBuffetPickerSelection(...)`
- `appendConfirmedBuffetItem(...)`

## Why this is separated

`pos-sales-module.tsx` is a large production module. This PR keeps the mode-to-table-order behavior typed and CI-checked before the direct UI patch.

## Next patch into `pos-sales-module.tsx`

1. Import `PosBuffetPricePickerModal`.
2. Import helpers from `buffet-table-sales-wire`.
3. Extend local `QuickMode` with `buffet_table`.
4. Add `buffetTablePicker` state.
5. Show table browser when `isTableSalesMode(quickMode)`.
6. Add a mode button using the existing selector UI.
7. After selected table is opened, call `buildOpenBuffetPickerState(...)`.
8. On modal confirm, call `confirmBuffetPickerSelection(...)` and `appendConfirmedBuffetItem(...)`.

## Future management UI

After the POS mode works with default plans, build:

- เพิ่มเติม > จัดการราคาบุฟเฟ่
- CRUD for buffet price plans
- Branch-level active/inactive plans
- Plan sort order and default plan
- Audit log for buffet price changes
