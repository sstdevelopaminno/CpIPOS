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

## Cart layouts

SD is intended to provide two views over the same cart state:

1. Product grid: category/product browsing plus SKU scanner and the existing cart.
2. Scanner table: scan-first item table with SKU, category, product, quantity, unit price and line total, while reusing the existing checkout/payment state.

The scanner/catalog bridge is implemented first and must pass CI before the scanner-table UI is integrated.

Validation checkpoint: scanner lookup, branch/package guard, legacy SKU normalization and React cart bridge are covered by unit/source-contract tests on this branch.
