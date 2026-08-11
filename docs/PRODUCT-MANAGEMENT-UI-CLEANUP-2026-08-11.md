# Product Management UI Cleanup — 2026-08-11

## Scope

System-wide Web POS cleanup for `/preview/pos/stock`. The Android POS terminal is the primary test device only; the behavior applies to every client using the shared Web POS page.

## Changes

- Moved the existing product-management action controls into the top page header: Best Sellers, Search/Filter, Manage Categories, Unit Stock, and Stock Settings.
- The actions are rendered into the header with a React portal so they keep the same client state and popup behavior rather than creating duplicated controls.
- Removed the old 60-product query cap from the active-product query and its legacy fallback. The list can now receive the full product result returned for the selected tenant/branch instead of stopping at 60.
- Product and ingredient list views use 10 rows per client page.
- Added an always-visible compact footer showing the visible range, current page/total pages, Previous, and Next.
- Long product/ingredient lists scroll inside a bounded table area and keep the table header sticky.
- Search/filter and stock-mode changes reset the list to page 1; existing category, stock, edit, delete/deactivate, selection, and bulk actions remain intact.

## Safety

- No database schema migration.
- No order, payment, shift, receipt, or sales transaction logic changed.
- Existing tenant/branch permission and catalog mutation paths remain authoritative.
- No production catalog rows were modified merely to validate this UI change.

## Verification

- Vercel production build for feature commit `99c568f5662243f2502c3516b6cfe28f5c09ef07` completed successfully and reached `READY`.
- `/preview/pos/stock` is included in the generated production route manifest.
- Final Android POS refresh must be issued through the one-time MDM post-deploy reload flow after documentation is committed.

## Manual acceptance checklist

- The five management buttons appear in the top header and no duplicate toolbar remains beside `รายการสินค้า`.
- A branch with more than 60 active products can paginate beyond item 60.
- Lists show 10 rows per page, with Previous / Page X of Y / Next controls.
- Table body scroll works on a long list and the column header remains visible.
- Search/filter and mode tabs reset to page 1.
- Product edit, deactivate, stock adjustment, category management, unit stock, stock settings, and ingredient actions still open their original dialogs and use their existing server APIs.

## Product Management header tabs + pagination follow-up — 2026-08-11

- Moved the existing `All / Unit Only / Ingredients` mode tabs into the top Stock Management action toolbar; the same React state and handlers remain authoritative.
- Removed the redundant `Product List` / `รายการสินค้า` heading from the body.
- Reduced the bounded product/ingredient table height from `56vh` to `45vh` and tightened pagination spacing so Previous / Page / Next sits higher on POS-class 1365x768 displays.
- Pagination remains 10 rows per page and no catalog, stock mutation, sales, receipt, shift, payment, tenant, or branch authorization logic changed.
- This is system-wide Web POS behavior; the physical POS terminal is the primary acceptance-test device only.


### Follow-up acceptance

- Header toolbar shows the three stock-mode tabs and the five management actions in the same top action region.
- The body no longer renders the `Product List` / `รายการสินค้า` title or a duplicate mode-tab row.
- Product and ingredient table wrappers use `max-h-[45vh]`.
- Pagination footer remains immediately after the table and uses `mt-2`, so the Next button is materially higher than the prior `56vh` layout.
- Feature commit `cdf410df79bfb34bbf047f418a83a6df43733837` passed Vercel production compile and TypeScript checks and reached READY before this finalizer.
