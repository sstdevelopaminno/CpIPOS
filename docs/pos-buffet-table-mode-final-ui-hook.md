# POS Buffet Table Mode Final UI Hook

## Purpose

This note records the final, intentionally small hook points for wiring **โต๊ะบุฟเฟ่** into the production POS sales screen.

The previous PRs already added:

- Buffet price plan types and modal foundation.
- Buffet table flow adapter.
- Feature gate contract for `buffet_table`.
- Sales wire helpers that map `buffet_table` to the existing dine-in/table lifecycle.

This PR prepares the final implementation checkpoint before editing `apps/backoffice-web/src/components/pos/pos-sales-module.tsx` directly.

## Final POS sales module hook points

The final patch should touch only the following areas in `pos-sales-module.tsx`:

1. Imports
   - Import `PosBuffetPricePickerModal`.
   - Import `DEFAULT_POS_BUFFET_PRICE_PLANS`.
   - Import sales wire helpers from `features/buffet-table-sales-wire`.
   - Import the buffet mode copy/contract from `features/buffet-table-mode-option`.

2. Quick mode type
   - Extend `QuickMode` from:
     - `"home" | "dine_in" | "delivery"`
   - To:
     - `"home" | "dine_in" | "delivery" | "buffet_table"`

3. Mode labels and icons
   - `getQuickModeLabel()` should return `โต๊ะบุฟเฟ่` / `Buffet table` when `quickMode === "buffet_table"`.
   - `QuickModeIcon` should render a table/buffet-compatible icon for `buffet_table`.

4. Table mode checks
   - Replace table-only checks that currently compare only `quickMode === "dine_in"` with `isTableSalesMode(quickMode)` where the behavior should apply to both dine-in and buffet table.
   - Keep payment/receipt behavior using `orderType === "dine_in"` because buffet table still submits as dine-in.

5. Mode selector
   - Add a visible mode option button for `buffet_table`.
   - Use the same lock/feature behavior as dine-in, because the feature gate maps buffet table to `table_management`.

6. Table selection
   - When the cashier selects a table in buffet mode, use the existing dine-in table open flow.
   - After the table context is loaded/opened, set picker state from `buildBuffetPickerStateForTableSelection(...)`.

7. Buffet picker modal
   - Render `PosBuffetPricePickerModal` when the picker state is open.
   - Confirming a plan should call `confirmBuffetTablePlanSelection(...)` and append the result to the existing cart.

## Expected cashier flow

1. Cashier selects **โต๊ะบุฟเฟ่**.
2. Existing table browser opens.
3. Cashier selects table.
4. System opens/selects the table bill using existing dine-in flow.
5. Buffet price picker opens.
6. Cashier chooses:
   - รายท่าน, or
   - แบบชุด
7. Cashier enters quantity.
8. Confirm adds the buffet price line to the cart.
9. The rest of the flow follows dine-in table billing and payment.

## Guardrails

- Do not duplicate table browser logic.
- Do not create a new order type for buffet table in this phase.
- Do not change backend order submission in this phase.
- Do not alter dine-in payment logic except where `quickMode` gates table UI.
- Keep the actual final patch small and test with `backoffice-web typecheck` and build.
