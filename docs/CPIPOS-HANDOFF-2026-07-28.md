# CpIPOS Handoff 2026-07-28

## Operating Mode

- User requested token-saving mode: keep responses short, avoid unnecessary exploration, and wait for explicit development commands.
- Before future code changes, read `docs/ACTIVE-DOCS-INDEX.md`, `docs/AI-GUARDRAILS-CPIPOS.md`, and this handoff.
- Update related docs on every implementation round so the next AI does not lose project direction.

## Current Verification

Run on 2026-07-28 from `E:\CpIPOS`:

- `corepack pnpm --filter backoffice-web lint` passed.
- `corepack pnpm --filter backoffice-web typecheck` passed.
- `corepack pnpm --filter backoffice-web test` passed: 27 files, 65 tests.
- `corepack pnpm --filter backoffice-web build` passed. First 5-minute attempt timed out; rerun with 10-minute timeout completed successfully.

## Latest Code Fix In This Round

- `apps/backoffice-web/scripts/dev-safe.mjs`: local dev now defaults to webpack again because Turbopack repeatedly panicked on `localhost:3000`; use `NEXT_DEV_BUNDLER=turbopack` only for explicit Turbopack testing.
- `apps/backoffice-web/scripts/dev-safe.mjs`: port cleanup now has fallback process termination paths so a stale Turbopack PID on port 3000 is not silently reused after switching back to webpack.
- `apps/backoffice-web/src/components/pos/pos-sales-module.tsx`: stabilized INET payment polling dependencies by using existing refs for table reload, table bill reload, and submit message callbacks.
- Fixed React lint issues around inline retry handlers and render-time ref access.
- Kept generated `apps/backoffice-web/next-env.d.ts` reverted after build changed it from dev to build route types.
- `apps/backoffice-web/src/components/pos-ui/pos-category-nav.tsx` and `apps/backoffice-web/src/app/globals.css`: category chips now support horizontal swipe/drag scrolling when many categories are present.
- `apps/backoffice-web/src/components/pos-preview/pos-shell-sidebar.tsx` and `apps/backoffice-web/src/app/globals.css`: POS main sidebar auto-collapses on compact landscape screens up to 1180px, remains manually toggleable, and animates width/padding during collapse/expand.
- `apps/backoffice-web/src/components/tables/table-zone-tabs.tsx` and `apps/backoffice-web/src/app/globals.css`: table zone tabs now stay on one row and support horizontal swipe/drag scrolling when many zones are present.
- `apps/backoffice-web/src/components/pos/pos-table-browser.tsx` and `apps/backoffice-web/src/app/globals.css`: removed secondary labels under the list/floor table view toggle buttons and tightened their height.
- `apps/backoffice-web/src/components/pos/table-qr-order-modal.tsx`, `apps/backoffice-web/src/app/api/pos/tables/[tableId]/qr-order/route.ts`, and `apps/backoffice-web/src/lib/table-qr-ordering.ts`: table QR creation now allows a 60s client wait with one automatic retry plus an in-modal retry button, enforces a 45s server timeout with timing header, keeps the modal closable while loading, and generates a lighter QR image to avoid timeout before the table-locked QR appears.
- `apps/backoffice-web/src/components/pos/pos-sales-module.tsx`: table QR loading no longer locks the whole POS sales screen via the global busy overlay; only the QR modal shows its own loading state.
- `apps/backoffice-web/src/components/table-order/table-order-mobile.tsx`, `apps/backoffice-web/src/app/api/table-order/[token]/route.ts`, and `apps/backoffice-web/src/lib/table-qr-ordering.ts`: public table QR menu load now allows 45s client wait, has a 30s server timeout with timing header, and caches branch menu products for 60s to reduce customer page timeout after scanning QR.
- `apps/backoffice-web/src/components/table-order/table-order-mobile.module.css`: refreshed customer QR ordering UI for mobile with tighter header, smaller product cards, compact sticky cart actions, rounded modern controls, and narrow-screen sizing.
- `apps/backoffice-web/src/components/table-order/table-order-mobile.module.css`: QR ordering page now owns vertical scrolling with `100dvh` overflow, and bottom action buttons were restyled as app-like touch controls with larger rounded targets and a compact dock.
- `apps/backoffice-web/src/components/table-order/table-order-mobile.tsx` and `apps/backoffice-web/src/components/table-order/table-order-mobile.module.css`: QR customer category chips now support smoother horizontal swipe when many categories exist, and the submit order button was moved from the fixed bottom dock into the cart details modal.
- `apps/backoffice-web/src/components/table-order/table-order-mobile.tsx`, `apps/backoffice-web/src/components/table-order/table-order-mobile.module.css`, `apps/backoffice-web/src/app/api/table-order/[token]/route.ts`, and `apps/backoffice-web/src/lib/table-qr-ordering.ts`: QR customer UI now turns the cart-details button green when food is in the cart, shows order/service success as auto-hiding popup toast instead of permanent inline green cards, keeps category chips horizontally swipeable for many categories, and blocks `request_checkout` until at least one food order has been submitted for the table session. The API also returns `food_order_required_before_checkout` for direct checkout requests before a food order exists.
- `apps/backoffice-web/src/app/api/pos/shifts/close/route.ts` and `apps/backoffice-web/src/components/pos/pos-shift-cycle-guard.tsx`: shift-close blocked messages for open bills are now Thai, with a UI fallback that translates the older English `Please clear ... open bill(s)` message. Shift close errors now appear as a temporary popup toast and auto-hide instead of staying as inline red text in the reminder modal.
- `docs/STABILITY-NETWORK-API-AUDIT-2026-07-28.md`: recorded current evidence for slow UI, unstable API behavior, local filesystem/cache pressure, slow Next dev compile, slow POS session/monitor endpoints, and deployment notes. `docs/ACTIVE-DOCS-INDEX.md` links to this audit.

## Workspace Notes

- Existing pending edits remain across login/session/Table QR/docs/Supabase migration files.
- Untracked files include:
  - `apps/backoffice-web/tests/integration/pos-session-current.integration.test.ts`
  - `apps/backoffice-web/tests/integration/pre-entry-auth.integration.test.ts`
  - `docs/LOCAL-DEV-LOGIN-PERFORMANCE-2026-07-27.md`
  - `image-3.png`
- Do not delete or revert pending/untracked files unless the user explicitly asks.
