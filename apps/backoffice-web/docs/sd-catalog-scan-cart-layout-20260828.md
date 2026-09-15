# SD catalog scan and cart layout hardening — 2026-08-28

Production baseline: `7c75b28592d2bec096464b6d2ef404c63184c9d7`.

## Scanner contract

- `SD / general_sale` remains package-gated through `barcode_scanner_mode`.
- Product Management is the source of truth for product SKU.
- A scanner or manual input resolves SKU through `/api/pos/products/lookup` using the active POS session tenant/branch.
- The lookup is read-only, no-store, branch-scoped and fail-closed on duplicate normalized SKU.
- Current Product Management writes SKUs with a digit-first normalization rule; the lookup accepts legacy prefixed values only when their normalized value exactly matches the scanned canonical SKU.
- A successful lookup is added through the same React `onAddProduct` path as a normal product-card tap.
- Scanning never creates an order and never deducts stock. Checkout/payment remains authoritative for order and stock mutation.
- Scanner input stays ready for hardware keyboard-wedge scanners. When scans arrive while a lookup is running, they are queued FIFO with a bounded queue instead of being silently dropped.

## Cart layouts

SD provides two views over the same authoritative React cart and checkout state:

1. **Product grid** — category/product browsing plus SKU scanner and the existing cart/payment panel.
2. **Scanner table** — scan-first table with SKU/barcode-as-SKU, category, product, quantity, unit price and line total. Product cards/category navigation are hidden in this view while the existing payment panel remains active.

The scanner table does not create a second cart. It reads the persisted Takeaway cart and product catalog snapshot only for rendering. Quantity/deletion controls delegate to the existing React cart controls, so all totals, stock limits, order creation, payment and receipt behavior stay on the existing POS engine.

Layout preference is local to the terminal (`grid` or `table`) and does not change tenant/branch business configuration.

## Validation boundaries

- Catalog lookup and package/session/branch guards are covered by source-contract tests.
- Canonical and legacy SKU normalization are covered by unit tests.
- Scanner-to-React cart bridging is covered by source-contract tests.
- Scanner-table row projection, totals, malformed-storage fail-soft behavior and live lookup metadata override are covered by unit tests.
- The SD controller must not call the POS sales transaction endpoint directly and must not add printer/kitchen behavior.
- No database migration is required by this slice.
