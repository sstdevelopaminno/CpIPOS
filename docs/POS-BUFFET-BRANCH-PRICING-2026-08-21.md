# POS Buffet Table Branch Pricing — 2026-08-21

## Continuation target

Continue the existing production `buffet_table` sales mode without reopening or wholesale-merging historical buffet branches.

## Problem closed in this checkpoint

The current picker carries fallback prices in source (`199` per person and `599` per set). The previous product resolver also updated an existing branch buffet product to the picker-submitted price every time the operator confirmed a buffet package. That made the UI default capable of overwriting a price configured by the store.

## New contract

- `GET /api/pos/buffet-products/resolve` loads the current branch products for the canonical buffet packages before the picker is selectable.
- If a matching branch product exists, its current database price and active state drive the picker.
- If no matching product exists yet, the existing fallback plan remains available and the first confirmed sale may create the canonical buffet product.
- `POST /api/pos/buffet-products/resolve` never overwrites an existing product price.
- The POST response returns the actual branch product price; the cart item is built with that server-resolved price.
- An inactive buffet product is respected and cannot be silently reactivated from the sales picker.
- Direct resolver access requires the current POS sales permission plus both `core_pos_sales` and `table_management` feature gates.

## Existing flow preserved

- `buffet_table` quick mode.
- Reuse of the dine-in table open/session workflow.
- Per-person and set package choice.
- Quantity keypad.
- Real product resolution before cart insertion.
- Existing checkout/payment/move-table behavior and mode preservation.

No database migration or payment/print/Kitchen change is included.
