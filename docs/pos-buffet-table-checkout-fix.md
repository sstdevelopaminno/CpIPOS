# POS Buffet Table Checkout Fix

## Scope

Fix `โต๊ะบุฟเฟ่` checkout so the payment button can enter the normal POS payment flow.

## Problem

The buffet picker originally added cart lines with virtual product IDs such as `BUFFET:buffet-per-person-standard`. The POS sales API validates every order item against the branch `products` table before creating/updating a bill. Because these virtual IDs are not real products, checkout could fail before the payment modal opened.

## Fix

- Add `/api/pos/buffet-products/resolve`.
- The resolver finds or creates a real active product for the selected buffet plan in the current tenant/branch.
- The buffet modal resolves the selected plan to a real `product_id` before adding it to the cart.
- The cart still displays the buffet package name and price, but checkout now sends a valid product ID to `/api/pos/sales`.

## Expected flow

1. Select `โต๊ะบุฟเฟ่`.
2. Select a table.
3. Select `บุฟเฟ่รายท่าน` or `บุฟเฟ่แบบชุด`.
4. Enter quantity and confirm.
5. The system resolves/creates the matching buffet product.
6. The buffet line is added to cart with a real product ID.
7. Click `ชำระเงิน`.
8. The normal dine-in payment flow opens.

## Follow-up

Persistent buffet price/product management under `เพิ่มเติม > จัดการราคาบุฟเฟ่` remains the next phase.
