# POS Buffet Table Mode Foundation

## Goal

Add a new POS table mode for buffet restaurants while preserving the current dine-in table workflow.

The target user flow is:

1. Cashier selects `โต๊ะบุฟเฟ่` in the POS mode selector.
2. Cashier clicks a table.
3. System opens the table bill using the same dine-in open-bill infrastructure.
4. System shows a buffet price picker popup.
5. Cashier chooses a buffet price plan:
   - `รายท่าน` / per person
   - `แบบชุด` / set
6. Cashier enters quantity.
7. System adds the buffet line into the cart.
8. Remaining table, cart, checkout, transfer, cash, QR, move table, and close bill behavior follows the existing dine-in mode.

## Files added in this foundation phase

- `apps/backoffice-web/src/lib/pos-buffet-pricing.ts`
  - Defines buffet price plan types.
  - Defines a safe default plan set.
  - Builds POS cart items from selected buffet plans.

- `apps/backoffice-web/src/components/pos/pos-buffet-price-picker-modal.tsx`
  - Popup for selecting buffet price plan.
  - Supports per-person and set plan display.
  - Supports quantity adjustment.
  - Emits a cart line for the existing POS cart.

## Future integration phase

The next phase should wire the foundation into `pos-sales-module.tsx`:

1. Extend `QuickMode` with `buffet_table`.
2. Add UI text for `โต๊ะบุฟเฟ่` / `Buffet table`.
3. Add the buffet mode button in the POS mode selector.
4. Reuse table browser from dine-in mode.
5. When a table is opened from buffet mode, show `PosBuffetPricePickerModal`.
6. Add confirmed buffet item to the current cart.
7. Persist buffet lines through existing dine-in cart/order payload.
8. Add a future submenu under `เพิ่มเติม > จัดการราคาบุฟเฟ่` to manage plans.

## Not included in this phase

- Database tables for buffet pricing.
- Backoffice management UI for buffet pricing.
- Final wiring into the POS mode selector.
- Server-side validation for buffet plan IDs.
- Reporting split by buffet type.

This foundation keeps the current POS dine-in workflow stable while preparing the component contract for the next PR.
