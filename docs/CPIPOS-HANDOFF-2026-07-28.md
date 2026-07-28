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
- `apps/backoffice-web/src/app/api/pos/shifts/clear-open-bills/route.ts` and `apps/backoffice-web/src/components/pos/pos-shift-cycle-guard.tsx`: added guarded recovery for stuck shift handoff. When `ต่อกะ` is blocked by `shift_has_open_bills`, the modal can show `เคลียร์บิลค้างและต่อกะ`; it cancels draft/queued/preparing shift orders, cancels open/ordering/pending table bill sessions, releases affected tables, writes `pos_shift_open_bills_cleared` audit, then continues the normal close/open shift flow.
- Follow-up fix: `apps/backoffice-web/src/lib/pos-shift-open-bills.ts` now centralizes open-bill recovery, and `/api/pos/shifts/close` accepts `clear_open_bills: true`. The POS shift-cycle UI sends this flag for close/continue/auto-close so stale open bills do not trap overdue shift closure. The manual recovery button is also visible in urgent/auto-close mode.
- `docs/POS-SHIFT-CLEAR-OPEN-BILLS-2026-07-28.md`: records the recovery design and guardrails so future AI does not remove the blocker or delete bills silently.
- `apps/backoffice-web/src/components/pos-preview/pos-sales-summary-dashboard.tsx`: moved KPI sales summary cards into a `สรุปยอดขาย` popup button before `คัดกรอง`, added pagination to the shift summary table, and changed `Export CSV` to export only the visible shift-summary table page.
- Follow-up CSV fix: sales-summary CSV export now includes UTF-8 BOM, `sep=,`, CRLF rows, and Thai/English headers based on the active language to prevent unreadable Thai text or collapsed columns in Excel.
- `docs/POS-SALES-SUMMARY-UI-2026-07-28.md`: records the sales summary UI change and notes that the attached print-agent text is architecture guidance, not a shell command.
- `apps/backoffice-web/src/lib/excel-csv.ts`: added a shared Excel-friendly CSV helper using UTF-16LE BOM, `sep=,`, CRLF, quoted cells, and formula escaping because Windows Excel could still open Thai UTF-8 CSV as mojibake.
- `apps/backoffice-web/src/components/pos-preview/pos-sales-list-workspace.tsx`, `apps/backoffice-web/src/app/api/pos/sales-list/route.ts`, and `apps/backoffice-web/src/lib/services/pos-sales-list-service.ts`: sales-list page now exports only the visible table page as readable Thai/English CSV, opens a real edit popup after PIN approval, and deletes records through an audited soft hide instead of local-only state changes.
- `apps/backoffice-web/src/components/pos-preview/pos-sales-summary-dashboard.tsx`: all sales-summary exports now use the shared CSV helper. The `ดูเพิ่มเติม` popup and `รายการขาย` popup each have their own right-side `Export CSV` button that exports the active/visible table columns only. The `ดูเพิ่มเติม` export button labels the active table name.
- `apps/backoffice-web/src/components/pos-preview/pos-sales-list-workspace.tsx`: live refresh now pauses while staff work in detail/filter/PIN/edit popups and polls every 5 seconds instead of every 2 seconds to reduce API pressure and UI jumps.
- `apps/backoffice-web/tests/integration/excel-csv.integration.test.ts`: verifies Thai CSV text, separators, formula escaping, and UTF-16LE BOM.
- `docs/POS-SALES-LIST-UI-2026-07-28.md`: records the sales-list CSV/edit/delete guardrails. User requested no commit, push, or deploy for this round until explicit instruction.
- `docs/STABILITY-NETWORK-API-AUDIT-2026-07-28.md`: recorded current evidence for slow UI, unstable API behavior, local filesystem/cache pressure, slow Next dev compile, slow POS session/monitor endpoints, and deployment notes. `docs/ACTIVE-DOCS-INDEX.md` links to this audit.

## Workspace Notes

- Existing pending edits remain across login/session/Table QR/docs/Supabase migration files.
- Untracked files include:
  - `apps/backoffice-web/tests/integration/pos-session-current.integration.test.ts`
  - `apps/backoffice-web/tests/integration/pre-entry-auth.integration.test.ts`
  - `docs/LOCAL-DEV-LOGIN-PERFORMANCE-2026-07-27.md`
  - `image-3.png`
- Do not delete or revert pending/untracked files unless the user explicitly asks.
