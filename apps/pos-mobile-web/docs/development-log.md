# Development Log

## 2026-07-30 Parallel Mobile/Web Sessions And Mobile Audit Trail

- Reviewed CpIPOS read-only for POS session revocation and activity audit shape; no CpIPOS files were edited.
- Mobile login no longer revokes every active `pos_sessions` row for the same tenant/branch/user. It creates a Mobile-owned session when possible, or reuses the active same-user/same-device session so Mobile and the main web POS can stay logged in together.
- Mobile active-session checks can recover to a current active same-device session when the stored cookie points at a session that the web POS replaced, reducing cross-platform logout loops.
- Mobile logout only revokes sessions created by CpIPOS Mobile. If Mobile is sharing/reusing a web session, logout clears the Mobile cookie but keeps the main web POS session active.
- Added `appendMobileAuditLog` to write Mobile actions into the shared `audit_logs` table using the CpIPOS activity-audit columns, with metadata marked `source_app: CpIPOS Mobile` and actor/device/session details. Audit write failures are logged but do not block sales or shift operations.
- Added Mobile audit entries for employee verification, session create/reuse/logout, takeaway bill open/hold/restore/checkout/cancel/member link, dine-in table open/hold/checkout/cancel, shift open/close/reuse, stock product/ingredient create/update/delete/restock, and member/settings saves.
- No Supabase schema or migration changes were made.

# Development Log

## 2026-07-30 Sales Mode Activity Dots And Dine-In RPC First

- Added red activity dots to the Mobile sales mode cards. The dots are derived from shared Supabase state so activity from either Mobile or the main web POS can surface on `กลับบ้าน`, `เลือกโต๊ะ`, or `เดลิเวอรี่`.
- `/sales` now checks active takeaway/dine-in/delivery orders and active table sessions for the current tenant/branch.
- Added RPC-first Mobile dine-in hold/checkout calls: `mobile_dine_in_hold_bill` and `mobile_dine_in_checkout_bill` are tried first, with the guarded TypeScript flow kept as fallback when production DB has not applied the functions yet.
- Added `docs/proposed-mobile-dine-in-rpc.sql.md` documenting the shared DB function signatures and required transaction behavior.
- Production build required stopping the local `next dev` server first because `next dev` and `next build` were both writing `.next`; after stopping dev, `npm run build` passed.
- CpIPOS was not edited.
## 2026-07-29 Mobile Sales Concurrency Hardening

- Reviewed CpIPOS read-only for dine-in table opening and shift close rules before changing Mobile.
- Hardened Mobile shift open so a duplicate open-shift race on the same tenant/branch/device reuses the just-created open shift instead of failing.
- Hardened Mobile shift close so it blocks closing when the same shift still has active dine-in orders or active table sessions opened by that shift.
- Mobile shift close now clears `pos_sessions.shift_id` for the same employee and cashier device, so matching Mobile/Web sessions see the shift as closed from shared `shifts` state.
- Hardened Mobile dine-in table opening so active table sessions are reused and concurrent order creation claims `table_bill_sessions.order_id`; an unclaimed empty draft is cleaned up.
- Hardened Mobile dine-in hold/checkout so it refuses to write if the table session is no longer active or no longer points to the same order, reducing cross-device overwrite risk.
- Preserved table-session metadata such as `opened_shift_id` when saving dine-in drafts, and release tables only for the matching order/session where possible.
- CpIPOS was inspected only; no files were edited there.
## 2026-07-29 Sales Menu Development Popup Serialization Fix

- Fixed `/sales` runtime crash after adding the member development popup.
- Cause: the server-rendered sales page passed a Lucide icon function into a client component, which Next.js rejects because client component props must be serializable.
- Changed `DevelopmentFeatureButton` to receive a plain `iconName` string and resolve the actual icon inside the client component.
- No CpIPOS files edited.
## 2026-07-29 CpIPOS Docs Preflight

- Read CpIPOS documentation from `E:\CpIPOS` only; no files were edited in that project.
- Confirmed CpIPOS is the main web POS source of truth for behavior that Mobile may need to mirror.
- Active CpIPOS docs to read before related work: `docs/ACTIVE-DOCS-INDEX.md`, `docs/AI-GUARDRAILS-CPIPOS.md`, `docs/CPIPOS-HANDOFF-2026-07-28.md`, `docs/CPIPOS-PRODUCTION-CHECKPOINT-2026-07-27.md`, `docs/STABILITY-NETWORK-API-AUDIT-2026-07-28.md`, and latest POS docs dated 2026-07-29.
- CpIPOS key guardrails carried forward for Mobile: token-saving mode, update docs every implementation round, never expose secrets, avoid broad schema/migration pushes, and do not edit CpIPOS unless explicitly requested.
- Mobile remains the editable workspace for this thread; shared Supabase changes require staged documentation and explicit approval.

## 2026-07-29 Stock Readiness Mobile Fit

- Reworked the Mobile `สินค้าพร้อมขาย` page so content stays inside the 430px mobile shell with narrower cards, `min-w-0` guards, compact pagination icon buttons, and no latest-order card at the bottom.
- Combined `สินค้าตามหมวด` and `สต๊อกวัตถุดิบคงเหลือ` into one card with a two-button switch: `สินค้า` and `วัตถุดิบ`.
- Made the `ออเดอร์ในกะ` stat card on the sales home link to `/orders`, so shift orders live under the sales-list flow instead of the stock readiness page.

## 2026-07-29 Main Stock Menu UI Alignment

- Replaced the main Mobile `สินค้า` menu UI with the same compact card/list pattern used by `สินค้าพร้อมขาย`.
- Added a horizontally scrollable category rail under the `สินค้า` mode so many product categories can slide left/right on mobile.
- Product and ingredient rows are now clickable to open a detail popup; edit/delete actions remain explicit buttons and continue to call the existing `/api/mobile/stock` API.
- Kept existing stock API behavior and permissions; no Supabase schema or migration changes were made.
- Verification passed: `npm run typecheck`, `npm run lint`.

## 2026-07-29 Held Badge And Takeaway Draft Freshness

- Added server-side held-bill counting on the Mobile sales home and passed it into `รายการพัก`.
- `รายการพัก` now shows a red dot and numeric badge when held takeaway bills exist; the count refreshes after opening or cancelling held bills.
- Changed the `กลับบ้าน` sales mode action to avoid prefetching `/sales/takeaway` and open it with a fresh navigation so stale prefetched draft-bill payloads are not reused after checkout, cancel, or hold flows.
- After receipt close and successful hold, Mobile refreshes `/sales` so held-bill badges and sales stats do not stay stale.
- Read CpIPOS receipt/printing docs and code from `E:\CpIPOS` only. CpIPOS receipt truth is the print queue/template path: 58/80mm text receipt with store profile, branch, `RECEIPT`, order/date/cashier, item rows, subtotal/discount/tax/total/payment, and print failure must not block payment.
- No CpIPOS files were edited and no Supabase schema or migration changes were made.

## 2026-07-29 Sales List Receipt UI

- Reworked Mobile `รายการขาย` into compact summary cards, a rounded search/filter panel, horizontally scrollable status filters, and receipt-style order cards that match the newer stock menu visual pattern.
- Replaced Mobile order detail cards with a 58 mm receipt-style paper preview based on the CpIPOS print template fields: store profile, branch, `RECEIPT`, order/date/cashier, item rows, subtotal, discount, tax, total, payment, cash, and change.
- Kept the supporting payment detail section under the receipt preview for staff review.
- No CpIPOS files were edited and no Supabase schema or migration changes were made.
- Verification passed: `npm run typecheck`, `npm run lint`.

## 2026-07-29 Sales List Sticky Search And Compact Rows

- Removed the extra Mobile order-detail summary/payment cards below the receipt preview so the page stays focused on the actual receipt format.
- Made the Mobile `ค้นหาบิล` panel sticky while scrolling inside the mobile shell.
- Converted sales order cards into a compact table-style list with lighter shadows, smaller rows, and disabled row prefetching to reduce tap lag.
- Added client-side pagination at 12 orders per page so large in-shift order lists do not render every row at once.
- No CpIPOS files were edited and no Supabase schema or migration changes were made.

## 2026-07-29 Dine-In Table Mode Foundation

- Read CpIPOS dine-in/table docs and source read-only. The Mobile implementation follows the CpIPOS table model: `dining_tables` is canonical, active table state comes from `table_bill_sessions`, and paid/cancelled table bills release the table back to `available`.
- Reduced Mobile `/sales/table` table-card size, added compact table counts, derived active table status from open/ordering/pending table sessions, and made table cards navigate to the table cashier route.
- Added Mobile `/sales/table/[tableId]` cashier flow that opens or reuses an active table session, creates/loads a `DIN-*` dine-in draft order, restores existing cart items for the same table, and reuses the cashier UI from the takeaway flow with dine-in endpoints.
- Added Mobile dine-in API endpoints for checkout, hold, and cancel. Dine-in checkout writes order items/payments, deducts recipe stock using `deduct_order_recipe_stock` with `dine_in`, closes the table session, and releases the dining table.
- No CpIPOS files were edited and no Supabase schema or migration changes were made.

## 2026-07-29 Dine-In Checkout RPC Signature Fix

- Fixed Mobile dine-in checkout stock deduction RPC call to match the shared CpIPOS `deduct_order_recipe_stock(uuid, uuid, uuid, text, uuid, text, text)` parameter name `p_created_by`.
- Root cause: Mobile sent `p_user_id`, so Supabase could not resolve the function in schema cache and `/api/mobile/sales/dine-in/checkout` returned 503.
- No CpIPOS files were edited and no Supabase schema or migration changes were made.

## 2026-07-29 Dine-In Zone Rail

- Added an optional Mobile zone rail above the table summary cards on `/sales/table`.
- The rail appears only when active `table_zones` exist for the current tenant/branch, uses `dining_tables.zone_id`, and scrolls horizontally when there are many zones.
- Zone chips include table counts and filter the server-rendered table grid via `/sales/table?zone=<zone_id>` without adding client state.
- No CpIPOS files were edited and no Supabase schema or migration changes were made.

## 2026-07-29 Dine-In Zone Popup

- Replaced the always-visible Mobile dine-in zone rail with a compact `โซน` button to keep the table selector cleaner.
- Added a popup zone picker with `ทั้งหมด`, zone colors, table counts, current-zone checkmark, and vertical scrolling for many zones.
- Zone selection still uses server-rendered `/sales/table?zone=<zone_id>` filtering and does not change Supabase schema or CpIPOS files.

## 2026-07-29 Dine-In Table Grid Paging

- Moved the Mobile dine-in table grid into a small client component so large table lists paginate without turning the whole page into client state.
- When the selected zone has more than 10 tables, Mobile shows 10 tables per page with `ก่อนหน้า` and `ถัดไป`, plus a vertically scrollable grid area.
- Table cards now show both the display name and `เลขโต๊ะ` from `dining_tables.table_code`.
- No CpIPOS files were edited and no Supabase schema or migration changes were made.

## 2026-07-29 Sales Menu Development Popups

- Read CpIPOS delivery/member references read-only: delivery still has a dedicated state-machine/test checklist and member APIs guard against missing `mobile_members` schema/columns.
- Mobile sales menu now treats `เดลิเวอรี่` as a development-mode shortcut and opens a popup instead of navigating to `/sales/delivery`.
- Mobile sales menu now treats the standalone `สมาชิก` shortcut as a development-mode popup. The member launcher inside cashier/cart flows was left in place so existing bill-linking UI is not removed.
- No CpIPOS files were edited and no Supabase schema or migration changes were made.

## 2026-07-18 Stock Menu UI Refresh

- Restyled the mobile stock menu to match the provided reference: larger product/ingredient tabs, taller search control, larger product and ingredient action buttons, rounded white list container, taller product rows, bigger edit/delete touch targets, and product thumbnails.
- Removed the visible latest stock deduction panel from the stock page UI.
- Verification passed: `npm run lint`, `npm run typecheck`.

- Follow-up stock UI adjustment: removed food-like product thumbnails, replaced them with compact neutral placeholders, and tightened mobile sizing so columns fit the 430px shell more cleanly.
- Verification passed after the follow-up: `npm run typecheck`, `npm run lint`.

## 2026-07-16 Web Push and Cash Keypad Stability

- Added Web Push backend routes for VAPID public key lookup, subscription save, and branch-scoped notification send.
- Added service worker push and notification click handling.
- Updated mobile notification banner to register push subscriptions and show clear PWA/install guidance.
- Added `docs/mobile-web-push.md` with required VAPID env and Supabase table setup.
- Tuned the cash payment dialog layering and touch behavior so keypad buttons are not blocked by lower navigation layers.

## 2026-07-16 Deploy Push Notification Automation

- Added a shared server Web Push sender with expired subscription cleanup.
- Added a protected system deploy notification endpoint for release automation.
- Added GitHub Actions workflow to notify mobile subscribers after push/deploy on `main`.
- Fixed Thai notification text mojibake in the mobile notification bar and service worker fallback.

## 2026-07-16 Cash Payment Keypad Tap Fix

- Lifted the cash payment action footer above the mobile bottom navigation safe area.
- Changed cash keypad, delete, clear, and quick-cash buttons to respond on pointer release with duplicate-tap guarding for more reliable mobile taps.
- Kept keyboard fallback for accessibility while avoiding duplicate pointer/click input.
- Updated cash input behavior so the first keypad tap replaces the auto-filled due amount instead of requiring users to clear the field first.

## 2026-07-12

- Created independent `SSTiPOSMobile` scaffold.
- Added mobile-first Next.js/PWA structure.
- Added Supabase server-only client and env validation.
- Added mobile login/dashboard scaffold.
- Copied SSTiPOS logo asset only; no secrets copied.
- No database migration applied.

## Verification Notes

- `corepack pnpm install` failed once because `@vite-pwa/next` was not available in npm registry; dependency was removed and replaced with a custom safe `public/sw.js` placeholder.
- `corepack pnpm install --network-concurrency 1` timed out after 5 minutes in this environment.
- `npm install` also timed out after 5 minutes.
- `npm run typecheck` and `npm test` could not run because dependency installation did not complete (`tsc` and `vitest` missing from local bin).

## 2026-07-12 Runtime Fix

- Fixed missing PATH workflow by documenting use of `pnpm.cmd`/Node path when needed.
- Fixed pnpm build approval by setting `allowBuilds` for `esbuild`, `sharp`, and `unrs-resolver` in `pnpm-workspace.yaml`.
- Renamed `next.config.cjs` to `next.config.js` for Next.js 15 compatibility.
- Added ESLint flat config and changed lint script to `eslint .`.
- Marked dashboard as dynamic runtime to avoid build-time Supabase env parsing.
- Fixed JSON encoding to UTF-8 without BOM.
- Verification passed: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.
- Dev server verified at `http://127.0.0.1:3000/login/store` with HTTP 200.
- Added `tsconfig.tsbuildinfo` to `.gitignore`; the file may be regenerated locally by TypeScript incremental builds.

## 2026-07-13 Logo Update

- Replaced mobile login logo with the provided CpIPOS PNG asset at `public/brand/cpipos-logo.png`.
- Updated auth shell and PWA manifest to reference the new logo.
- Verification passed: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## 2026-07-13 Login UI Match

- Updated store login screen to match the provided sample: centered CpIPOS logo, Thai/EN toggle, rounded blue-bordered card, store icon input, 0/32 counter, and blue next button.
- Verification passed: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## 2026-07-13 Login Card Centering

- Removed the Thai/EN language toggle from the store login card.
- Centered the login card vertically and horizontally on the mobile screen.
- Verification passed: `pnpm typecheck`, `pnpm lint`, `pnpm build`.

## 2026-07-13 Shared Database Auth Flow

- Replaced in-memory mobile login context with a signed HttpOnly mobile flow cookie.
- Store code verification now creates a real `pos_login_contexts` row in the shared SSTiPOS Supabase database when a single active branch is available.
- Multi-branch login stores the verified tenant in a signed cookie first, then creates the `pos_login_contexts` row after branch selection.
- Branch selection validates active branches from the shared `branches` table and creates or updates the login context scope.
- Employee login verifies employee code against `user_branch_roles`/`pos_user_profiles` and creates a real `pos_sessions` row.
- Removed client `sessionStorage` dependency from login flow.
- Verification passed: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.

## 2026-07-13 Env and Login Smoke Test

- Created local `.env.local` from the existing SSTiPOS backoffice env keys without committing secrets.
- Verified real shared-database login smoke locally: `NDL-TH-001` -> `NDL-ONNUT-01` -> employee `sst182536` -> dashboard HTTP 200.
- Confirmed `/login/store` HTML includes Next CSS assets on the fresh dev server.

## 2026-07-13 Vercel Production Check

- Created and deployed Vercel project `sstiposmobile`.
- Production alias verified: `https://sstiposmobile.vercel.app`.
- Verified production `/login/store` returns HTTP 200 and includes Next CSS assets plus CpIPOS content.
- Vercel env values must be entered in Vercel Dashboard; secrets are intentionally not committed or printed.
## 2026-07-13 Vercel Env Safety

- Attempted Vercel env automation was stopped by secret-safety controls because it would transmit `SUPABASE_SERVICE_ROLE_KEY` and `MOBILE_SESSION_SECRET` from local `.env.local` to an external service.
- Documented the safe manual Vercel Dashboard env setup path in `docs/vercel-env-checklist.md`.
- No Vercel token or secret env values were written to repository files.

## 2026-07-13 Session Cookie Hardening

- Hardened mobile session cookie decoding so malformed or tampered cookies return `null` instead of throwing.
- Updated security checklist to reflect the DB-backed login context and employee-code verification now present in code.
- Verification passed: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## 2026-07-13 Store Login Error Handling

- Improved store-code login form to preserve API error messages instead of showing a generic connection failure for every non-OK response.
- Added JSON content-type headers across store, branch, and employee login requests.
- Wrapped auth API route handlers with JSON error responses so server-side Supabase errors do not fall through as HTML 500 responses.
- Hardened store-code branch handling by ignoring invalid branch rows and using `MOBILE_LOGIN_CONTEXT_TTL_MINUTES` for login context expiry.
- Verified Supabase data for `NDL-TH-001`: active tenant with two active branches.
- Verification passed: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## 2026-07-13 Store Login Abort Fix

- Removed the store login form's hard 8-second `AbortController` timeout because local Next.js cold starts and Supabase checks can legitimately exceed it.
- Added a friendly fallback for any future browser abort error instead of exposing `signal is aborted without reason`.
- Verification passed: `npm run lint`, `npm run typecheck`, `npm test`.

## 2026-07-13 Dev Cache Reset

- Diagnosed `next-devtools/userspace/app/segment-explorer-node.js#SegmentViewNode` and `__webpack_modules__[moduleId] is not a function` as a stale/corrupt Next.js dev cache issue.
- Stopped stale `node.exe` dev processes and renamed `.next` to `.next-stale-20260713-105224` so `npm run dev` can regenerate a clean manifest.
- Added `.next-stale-*` to `.gitignore` so local dev cache backups do not appear in git status.
- Follow-up command for this case: stop `npm run dev`, move or delete `.next`, then run `npm run dev` again.

## 2026-07-13 Branch Selection UX Fix

- Fixed invisible branch names by replacing the undefined `text-ink` class with an explicit dark text color on white branch buttons.
- Cached the branch list returned by store-code verification in `sessionStorage` as a UI-only cache so `/login/branch` can render branches immediately while still revalidating with the server.
- Branch selection remains server-enforced; cached branch data is not trusted for POST validation.
- Added `.next-stale-*/**` to ESLint ignores so local dev cache backups are not linted.

## 2026-07-13 Branch Page Server Render

- Changed `npm run dev` to `next dev --turbo` to avoid the webpack devtools `segment-explorer-node.js#SegmentViewNode` manifest error seen in local dev.
- Rebuilt `/login/branch` as a server-rendered page that reads the signed mobile flow cookie and loads active branches before sending HTML.
- Moved branch selection POST behavior into `src/components/auth/branch-selector.tsx`, keeping branch selection server-validated while ensuring branch names are visible even before client hydration completes.

## 2026-07-13 Stable Local Dev Command

- Diagnosed Turbopack `unrecognized HMR message {"event":"ping","page":"/_error"}` as a local HMR websocket/dev-server compatibility issue in Next.js 15.5.20.
- Changed `npm run dev` to run `next start` so local testing uses the latest successful production build without HMR or repeated cold builds.
- Added `npm run dev:hot` for optional hot-reload work with Turbopack when needed.
- After an interrupted build left `.next` incomplete, moved it to `.next-stale-20260713-113708` and verified a clean `npm run build` succeeds.
- Local workflow is now `npm run build` after code changes, then `npm run dev` for stable testing.

## 2026-07-13 Branch Button Visibility Fix

- Replaced the shared `Button` component in branch selection with a native button so the shared `text-white` default cannot override branch labels.
- Added explicit dark inline text color and a two-line branch layout showing branch name and branch code.
- Rewrote corrupted Thai fallback strings in `src/components/auth/branch-selector.tsx`.

## 2026-07-13 Employee Code Login

- Removed the PIN input from `/login/employee`; employee login now submits only `employeeCode`.
- Updated `/api/auth/employee/verify` and employee-code verification to validate active branch membership without bcrypt PIN comparison.
- New `pos_sessions.login_method` value for this mobile flow is `employee_code`.
- Updated README, auth flow, Vercel checklist, manual QA checklist, and security checklist to remove stale PIN instructions.

## 2026-07-13 Cashier Device and Shift Gate

- Split employee verification from POS session creation so entering an employee code no longer skips directly to the dashboard.
- Added `/login/device` and `POST /api/auth/devices/select`; cashier devices are loaded from `branch_devices` and validated server-side before creating `pos_sessions`.
- Extended mobile session cookies with `deviceId`, `deviceCode`, and `deviceName`.
- Updated dashboard to show a required open-shift gate when no `shifts.status = open` row exists for the selected tenant, branch, and cashier `device_code`.
- Added `/shifts` and `POST /api/mobile/shifts` so the selected cashier device can open and close its own shift.
- Reworked branch, employee, device, dashboard gate, and shift UI to follow the provided SSTiPOS flow screenshots.

## 2026-07-13 Store Login Fetch UX

- Hardened store-code verification fetch with explicit JSON accept headers, same-origin credentials, and no-store caching.
- Replaced raw browser `Failed to fetch` text with a Thai server-connection message that points the operator to confirm the local server is running.
- Unregisters stale service workers from the login form to prevent old PWA handlers from intercepting auth API requests.
- Made the next button visibly darker and taller when a store code is entered, while keeping the disabled state pale.

## 2026-07-13 Login Step Loading Popups

- Added a reusable auth loading dialog with CpIPOS branding, spinner, title, and status message.
- Store-code, branch-selection, employee-code, and cashier-device steps now show the loading dialog while server validation and route transition are in progress.
- Kept loading state active during successful navigation to prevent flicker and double-submit while the next server-rendered step is loading.
- Added explicit `Accept: application/json`, `cache: no-store`, and `credentials: same-origin` to branch, employee, and device auth fetches.
- Rewrote branch, employee, and device auth UI text to clean Thai UTF-8 and removed stale mojibake strings.
- Reduced auth-shell vertical padding and hid scrollbars globally/mobile-shell so the mobile web app feels more like an installed application.

## 2026-07-13 Mobile Bottom Menu and Shift Access

- Replaced the mobile bottom navigation with the requested app menu: `ขาย`, `รายการขาย`, `จัดการสินค้า`, `ปิดยอด`, and `ตั้งค่า`.
- Bottom navigation now appears only when the selected cashier device has an open shift.
- The no-shift gate links to `/shifts` with the user-facing label `ไปเมนูปิดยอด`.
- `/shifts` is now titled `ปิดยอด`; opening a shift refreshes the same page so the bottom menu appears there instead of jumping back to dashboard.
- Added role-based menu visibility: owner/manager see all menus, staff see sales/order/close-total, and accountant is limited to sales-list access.
- Added server-side route guards so direct URL access to sales/order/stock/settings requires an open shift and the allowed role.
- Added server-side role enforcement to `POST /api/mobile/shifts` for open/close shift actions.

## 2026-07-13 Opening Cash and Sales Redirect

- Added required opening-cash input to the `ปิดยอด` page before opening a shift.
- `POST /api/mobile/shifts` now validates `openingCash` for open-shift requests and stores it in `shifts.opening_cash` and `shifts.expected_cash`.
- Opening a shift now redirects directly to `/sales` instead of staying on the `ปิดยอด` page, preventing the loading dialog from feeling stuck.
- Added quick opening-cash buttons for `0`, `500`, `1,000`, and `2,000`.
- Replaced the sales placeholder with a blank mobile POS starter surface titled `พร้อมขาย` for the next design pass.

## 2026-07-13 Sales Mobile UI Starter

- Rebuilt `/sales` into a mobile POS launcher matching the provided reference: ready-to-sell status card, quick actions, summary cards, recent sales, and POS starter banner.
- Added sales header subtitle and a notification action slot to `MobileAppShell`.
- Sales summary reads recent same-day orders for the selected tenant and branch, with mock fallback values when no orders exist.
- Kept the sales screen guarded by open-shift and role checks before rendering the mobile POS UI.

## 2026-07-13 Sales Branding Header

- Removed the `SSTiPOS Mobile` eyebrow from the shared mobile app shell.

## 2026-07-13 Dashboard Entry Removal

- Removed the old dashboard summary screen from the post-login path.
- Cashier device selection now redirects to `/shifts` so operators open the selected device shift before selling.
- `/dashboard` is now a compatibility redirect to `/sales` when the device shift is open, or `/shifts` when it is not.
- Closing a shift redirects back to `/shifts`.
- Added an optional brand slot to `MobileAppShell` so pages can render product branding without hard-coded shell text.
- Added CpIPOS logo and wordmark beside the `ขาย` header and kept the notification action on the right.
- Added a subtle CpIPOS watermark inside the ready-to-sell card background instead of using a large visible logo block.
- Updated app metadata and login subtitle from `SSTiPOS Mobile` to `CpIPOS Mobile`.
- Replaced the sales header and ready-card watermark image with the standalone CpIPOS symbol at `public/brand/cpipos-symbol.png` while keeping the `CpIPOS` name text.
- Removed the sales page title/subtitle text so the top header shows only the CpIPOS brand row and notification action.

## 2026-07-13 Live Dev and Sales Cleanup

- Changed `npm run dev` back to `next dev` so UI and system edits hot reload immediately during development.
- Kept production-like local testing available as `npm run dev:stable` after `npm run build`.
- Kept optional Turbopack testing available as `npm run dev:turbo`, but it is no longer the default because prior local HMR pings were unstable.
- Cleaned the pending sales/logo changes and kept the CpIPOS symbol asset at `public/brand/cpipos-symbol.png`.
- Rewrote the `/sales` Thai UI strings to valid UTF-8 after the previous logo/header pass left mojibake text in the page.
- Verification passed: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- Local live-dev smoke: `npm run dev -- --port 3017` opened a listener on port `3017`; the test process was stopped after verification.

## 2026-07-13 Dev Cache Stability

- Added a pre-dev cache cleanup so `npm run dev` clears `.next` before starting Next.js.
- This prevents stale React client manifest errors such as `segment-explorer-node.js#SegmentViewNode`, `MODULE_NOT_FOUND`, and `__webpack_modules__[moduleId] is not a function` after repeated page edits.

## 2026-07-14 Takeaway Cart Hold and Payment Popup

- Moved the takeaway action buttons into the summary and cart cards so the screen reads as two connected POS surfaces instead of separate floating controls.
- Added a payment popup from the `ชำระเงิน` button with cash and transfer choices, including payment-method icons.
- Added database-backed held-bill APIs: `POST /api/mobile/sales/takeaway/hold` stores the draft order, line items, discounts, and totals as `orders.status = held`; `GET /api/mobile/sales/takeaway/held` lists held takeaway orders with line-item details.
- Wired the `พักบิล` button to persist the current cart to the held order state, clear the current cart UI, and refresh the page for the next draft bill.
- Wired the `รายการพัก` button to open a popup listing held bills and item details from the real tenant/branch database scope.
- Improved click stability by separating held-list loading from hold-submit loading, disabling duplicate hold submits, and clearing the product-added notice timeout on component unmount.
- Verification passed: `npm run typecheck`, `npm run lint`, `npm run build`.

## 2026-07-14 Takeaway Full-Screen Payment Flow

- Changed the takeaway payment flow to use three UI states: payment-method choice, full-screen cash collection, and full-screen 58 mm receipt preview.
- Cash payment now opens a mobile full-screen screen with amount due, received cash, quick cash buttons, numeric keypad, calculated change, cancel, and confirm payment controls.
- Transfer payment still uses the existing checkout endpoint and now proceeds to the receipt preview after a successful payment.
- Successful checkout clears the POS cart locally, keeps the paid order in the shared `orders`/`payments` database for the `รายการขาย` menu, and shows a receipt preview instead of immediately redirecting away.
- Receipt preview includes CpIPOS branding, store/branch labels, bill number, payment date, line items, totals, received amount, change, and a print button that calls `window.print()` before closing the payment window.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-14 Takeaway Transfer QR Payment Flow

- Checked the SSTiPOS POS transfer-payment modal and sales API behavior before implementing Mobile: SSTiPOS reads active `tenant_payment_accounts`, supports `promptpay_link` and `qr_image`, and exposes INET QR availability from `pos_payment_provider_settings`.
- Added `GET /api/mobile/payments/qr` so SSTiPOSMobile loads the same branch-scoped QR/payment-account configuration instead of hardcoding QR data in the UI.
- Changed the transfer payment choice to open a mobile full-screen `รับชำระเงินโอน` page with amount due, manual transfer / INET QR tabs, QR preview, account details, confirm button, and a saving overlay.
- Manual transfer confirmation still uses `POST /api/mobile/sales/takeaway/checkout`, so successful transfer payments clear the POS cart, write the shared `orders`/`payments` records, and move to the 58 mm receipt preview.
- INET QR is surfaced as a tab to match SSTiPOS terminology, but the Mobile flow currently blocks confirmation there until the INET create/status endpoint is wired into SSTiPOSMobile.
- Reduced the transfer QR screen height after visual review: compacted header spacing, amount text, card padding, QR container, QR image size, helper text, and confirm button so the screen fits better above the mobile bottom menu.
- Further compacted the transfer QR screen after the second visual pass: removed the stretched middle row, reduced the QR image to 220px max, tightened tab/button heights, and moved the confirm button directly under the QR card.
- Fixed transfer checkout from the reported stuck overlay: the Mobile checkout endpoint now closes orders with `orders.status = completed`, matching the local order enum and shift summaries, instead of the invalid `paid` value; the error handler also no longer writes a non-enum `error` status.
- Reduced the transfer confirm button width and hid the transfer dialog scrollbars so the QR payment screen no longer shows the tall browser scrollbar from the visual report.
- Rechecked the payment status schema from SSTiPOS migrations and changed Mobile payment rows back to `payments.status = paid` while keeping orders as `completed`; this matches the shared database contract and prevents transfer checkout from failing at the payment insert step.
- Locked `html` and `body` scrolling while the full-screen transfer QR view is open to hide the underlying mobile shell scrollbar, not only the transfer card scrollbar.
- The terminal `segment-explorer-node.js#SegmentViewNode` error is a stale Next dev manifest/cache symptom; stop the running dev server and restart with `npm run dev` so the existing predev cache cleanup can regenerate `.next`.
- Added Windows-specific webpack watch ignore rules for `System Volume Information` and `$RECYCLE.BIN` to reduce dev-server watcher errors and slow recompiles on drive-root scans; kept the patterns as forward-slash glob strings because this Next/Watchpack version rejects RegExp values and backslash globs.
- Added a real CSS spinner animation for QR loading and transfer-saving overlays; the loader no longer appears frozen while waiting for the QR/payment request.
- Compact receipt preview layout: smaller header, store block, line rows, totals, scroll area, and a shorter print button so the 58 mm receipt screen fits better on mobile.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Login Open Shift Redirect

- Updated the device-selection login flow to check for an existing open shift for the verified employee on the selected branch/device.
- Employees who already have an open shift now receive `redirectTo: "/sales"` after device selection, so they enter the sales menu directly.
- Employees without an open shift still receive `redirectTo: "/shifts"` and must open a shift before selling.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Mobile Receipt Store Profile

- Connected the Mobile takeaway receipt preview to the same tenant receipt profile fields used by SSTiPOS: `tenants.display_name`, `logo_url`, `company_address`, `contact_phone`, and branch name.
- Replaced the hard-coded receipt logo/store labels in the Mobile receipt preview with the shared store profile values, falling back to the CpIPOS symbol only when no tenant logo is configured.
- Further reduced the 58 mm receipt preview height and button size so the print button stays visible while receipt content scrolls inside the preview card.
- After checkout receipt close/print, Mobile now returns to `/sales` instead of reopening `/sales/takeaway`, so the POS cart is cleared and the operator must choose a sales mode to open a new bill.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Login Speed and Cash Payment UI

- Reduced store-code login perceived delay by no longer awaiting service worker cleanup before calling `/api/auth/store-code/verify`; cleanup now runs in the background while the auth request starts immediately.
- Reworked the cash payment screen to better match the SSTiPOS-style payment flow on mobile: compact amount/received summary at the top, numeric keypad moved below it, side delete/clear controls, quick cash buttons under the keypad, change summary near the bottom, and shorter action buttons.
- Kept the cash confirmation wired to the existing takeaway checkout endpoint so successful cash payment still writes the shared `orders`/`payments` records and shows the receipt preview.
- Tightened the cash payment viewport after visual review: the full-screen cash dialog now hides outer scrolling, uses a fixed available-height grid, smaller keypad rows, narrower quick-cash buttons, and a compact footer so the cancel/confirm buttons stay visible.
- Matched the cash confirmation step to the transfer flow: locked body scrolling while the cash screen is open, added a compact blue `ยืนยันชำระ` action with an icon, and reused the saving overlay while the checkout API records the sale.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Login and Sales Responsiveness Fix

- Removed the hard client-side 12-second abort from store-code login so slow Supabase/Next responses do not incorrectly fail with a timeout while the server is still working.
- Added route prefetching and a 10-second navigation watchdog to store, branch, employee, and device login steps so a slow transition releases the loading state and gives the operator a retry message instead of appearing permanently stuck.
- Rewrote mojibake Thai text in branch selection, employee login, device selection, and the `/sales` launcher so the UI renders stable, readable Thai labels.
- Added `touch-manipulation`, larger tap areas, active feedback, and explicit prefetching to sales quick actions and the bottom navigation to improve mobile tap responsiveness.
- Reduced `/sales` initial data loading by replacing the active-product row fetch with a Supabase count query, keeping the same displayed product total without downloading up to 500 product rows.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Dev Server Cache Auto-Recovery

- Added `scripts/dev-safe.mjs` and changed `npm run dev` to start Next through this wrapper instead of calling `next dev` directly.
- The wrapper clears `.next` before startup and watches stdout/stderr for the recurring Next dev manifest/cache failures seen during local editing: `segment-explorer-node`, `SegmentViewNode`, `React Client Manifest`, `__webpack_modules__[moduleId] is not a function`, `/_app` undefined, and `MODULE_NOT_FOUND`.
- When one of those errors appears, the wrapper terminates the current dev process, clears `.next`, and restarts Next dev automatically so the developer does not need to manually stop the server and delete cache every time.
- Kept raw Next dev available as `npm run dev:next` for debugging the framework behavior without the recovery wrapper.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Dev Server Missing Manifest Patterns

- Extended `scripts/dev-safe.mjs` to also recover from missing generated chunk errors such as `Cannot find module './87.js'`, missing `.next/fallback-build-manifest.json`, and generic `.next` `ENOENT` runtime cache errors.
- These errors are the same stale/incomplete Next dev build state as the earlier `segment-explorer-node` manifest issue, but they appear under different file names after route recompilation.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Numeric Employee Code Field

- Locked the employee login field to numeric input only by filtering non-digit characters in the mobile form and validating `employeeCode` as 1-32 digits on the auth API.
- Changed the employee code input to a password-style field with an eye toggle so operators can briefly reveal the code for checking.
- Added automatic hiding after 5 seconds and on blur/submit so the code returns to the masked state without manual action.
- Cleaned the employee-login UI and API Thai messages that had reverted to mojibake text.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Safe Dev Alias Clarification

- Changed `npm run dev:next` to use the same `scripts/dev-safe.mjs` wrapper as `npm run dev` because the raw Next command still hits the known missing chunk and `/_app` cache failures.
- Added `npm run dev:raw` for the rare case where raw `next dev` is needed to debug framework behavior without auto-recovery.
- Updated README command descriptions so daily development uses only the safe runner.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Build and Typecheck Cache Isolation

- Added `tsconfig.typecheck.json` and changed `npm run typecheck` to use it so local source typechecks do not depend on `.next/types` existing after dev cache cleanup.
- Kept Next's generated `.next/types/**/*.ts` in the main `tsconfig.json` because `next build` manages and validates those generated route types.
- Added `prebuild` cache cleanup before `next build` and documented that the dev server should be stopped before production builds because both commands write to `.next`.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Sales Mode Navigation Feedback

- Replaced the `/sales` shortcut links with a client-side `SalesModeActions` component so tapping `กลับบ้าน`, `เลือกโต๊ะ`, or `เดลิเวอรี่` immediately shows pressed state and a loading dialog before the server-rendered destination finishes loading.
- Added `/sales/loading.tsx` as a route-level loading fallback for sales-mode transitions, reducing the feeling that the UI is frozen during server guard/database work.
- Kept route prefetching for all sales modes and disabled duplicate taps while a mode is opening to avoid double navigation.
- Rewrote mojibake Thai labels in the `/sales`, `/sales/table`, and `/sales/delivery` screens.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Cash Payment Keypad Fit

- Increased the cash keypad number buttons from 36px to 40px high and slightly widened the side delete/clear column so the controls look more balanced on mobile.
- Slightly increased quick-cash button height and width while keeping the three-button row inside the 430px mobile frame.
- Raised the cash payment footer by reducing the dialog available height and adding footer bottom padding, so the `ยืนยันชำระ` action sits higher above the bottom navigation.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Cash Keypad Enlargement

- Moved the numeric keypad block down slightly with additional top margin and label spacing.
- Enlarged numeric keypad buttons from 40px to 44px high, increased key font size, widened the delete/clear column, and increased keypad gaps for a roomier touch target.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Cash Keypad Centering and Spacing

- Enlarged cash keypad buttons again from 44px to 48px high, increased key font size, widened the delete/clear column, and increased keypad gaps to make the keypad feel more balanced.
- Centered and widened the quick-cash row with equal-width buttons, larger button height, and cleaner spacing between the three quick amount choices.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Cash Change and Footer Button Sizing

- Enlarged the cash change summary row with wider layout, larger label/value text, and roomier padding.
- Raised the cash payment footer upward, widened both cancel and confirm columns, increased button height, and improved the spacing between the two footer actions.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Cash Amount Summary Enlargement

- Enlarged the cash amount summary card with larger padding, bigger labels, and larger amount values for both `ยอดที่ต้องชำระ` and `รับเงินสด`.
- Increased row gaps and divider spacing so the amount summary reads more clearly at mobile width.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Checkout Receipt and Sales List Stability

- Centralized paid-bill cleanup after successful takeaway checkout so cart lines, discount, cash input, transfer reference, popups, and paging are cleared immediately after the database checkout succeeds.
- Changed receipt close behavior to `router.replace("/sales")` plus refresh so closing the receipt returns to the sales mode menu immediately and the next `กลับบ้าน` click creates a fresh draft bill number.
- Added visible `พิมพ์ใบเสร็จ` actions at the top and bottom of the receipt screen so print is reachable even when receipt content fills the viewport.
- Rewrote the `รายการขาย` page Thai labels and status/type display, keeping it backed by the shared `orders` query for the current shift.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Held Bills Moved to Sales Menu

- Moved the `รายการพัก` action out of the takeaway cashier button row and added it to the main `/sales` menu as a dedicated `HeldOrdersLauncher`.
- Updated `พักบิล` so a successful hold writes the draft order as `orders.status = held`, clears the current cashier cart state, and returns the operator to `/sales`.
- Added held-bill restore from the sales menu: selecting `เรียกกลับ` changes the held order back to draft, navigates to `/sales/takeaway`, and the takeaway page loads existing draft line items back into the cart.
- Added server-side draft item loading for `/sales/takeaway` so restored held bills are visible after navigation, not only when restored from an in-page modal.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Empty Draft Hold and Hold Popup

- Fixed the takeaway hold API so draft bills with zero cart lines can still be moved to `orders.status = held` without trying to insert an empty `order_items` payload.
- Kept product validation and item persistence for non-empty carts, while allowing the cashier to park a newly opened bill before products are added.
- Changed the cashier `พักบิล` button so it remains available for empty draft bills and shows a modal saving popup while the hold request is being recorded.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Held Bill Enum Compatibility Fix

- Fixed the production database enum mismatch where `orders.status = held` failed because the current `order_status` enum does not include `held`.
- Kept held bills as `status = draft` and marks them with `metadata.hold_state = held`, so the hold flow works without a database enum migration.
- Updated the held-bill list and restore APIs to read held bills from metadata, and changed `/sales/takeaway` to ignore held drafts when opening a fresh cashier bill.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-15 Held Bill Cancel With PIN

- Added a cancel action to each held bill in the `/sales` held-bill popup.
- The cancel flow opens a PIN confirmation dialog and reuses the existing manager/owner PIN validation from the takeaway cancel API.
- Updated the cancel API to preserve existing order metadata and mark held drafts as `hold_state = cancelled` when the bill is voided.
- Cleaned the held-bill popup Thai labels while keeping restore and loading feedback intact.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-16 Product Picker Responsiveness and Ingredients

- Reduced the takeaway product picker height from nearly full-screen to a centered compact dialog so it no longer stretches too far down the viewport.
- Limited the rendered product cards per open picker to reduce tap lag from large product lists, while keeping category filtering available to narrow the list.
- Added a second-step ingredient selector for products that provide `metadata.ingredients` or `metadata.recipe`, showing each ingredient name, quantity, and unit before adding the product to the cart.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-16 Hold Bill Navigation Stability

- Removed the immediate `router.refresh()` after successful takeaway hold because it could race with `router.replace("/sales")` and re-render the cashier screen with a new draft bill.
- Changed the hold success path to clear cashier state, close transient dialogs, dismiss the hold popup, and then navigate directly to the sales menu.
- Added an update-result guard in the hold API so the client only leaves the cashier screen after the draft order is confirmed as held.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-16 Six Digit Numeric PIN Entry

- Changed takeaway bill cancellation PIN entry to accept digits only and cap input at 6 characters.
- Replaced the free-text PIN field with six fixed digit boxes so operators can clearly see the required PIN length.
- Applied the same six-digit numeric PIN control to held-bill cancellation from the held-bill popup.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-16 Login Flow Redirect Stability

- Removed login-step route prefetching that could cache a redirect from `/login/branch`, `/login/employee`, or `/login/device` before the mobile login-flow cookie was written.
- Changed successful store, branch, employee, and device transitions to use full-page navigation after the API response so the next server-rendered page always reads fresh cookies.
- Marked the branch, employee, and device login pages as `force-dynamic` with `revalidate = 0` to prevent stale redirect decisions from being reused.
- Per user instruction, this change was documented before any commit/push/deploy; no release action was taken in this step.

## 2026-07-16 Mobile SSO Session Restore

- Added an active-session check endpoint at `/api/auth/session/current` so the store login page can restore an existing mobile session and continue to `/sales` or `/shifts`.
- Protected routes now validate the signed mobile cookie against the backing `pos_sessions` row and refresh the cookie expiry when the DB session is still active.
- Aligned created POS session expiry with `MOBILE_SESSION_TTL_HOURS` instead of a hard-coded 12-hour value.
- Kept the store login code path available when no active session exists, while preventing normal reloads from unnecessarily dropping operators back to the first login step.
- Per user instruction, this change was documented before commit/push/deploy; no release action was taken in this step.

## 2026-07-16 Mobile PWA Notifications

- Added a lightweight top mobile notification bar that can show system update notices, online/offline status, and custom in-app alerts.
- Registered a stable service worker from the root layout and removed the old login-time service worker unregister flow that could cause PWA reloads or sluggish behavior.
- Replaced the self-unregistering `public/sw.js` with a stable pass-through service worker that claims clients and posts readiness messages without forcing navigation.
- Updated the web app manifest with app id, scope, display overrides, shortcuts, and Android/iOS-friendly metadata.
- Per user instruction, this change was documented before commit/push/deploy; no release action was taken in this step.

## 2026-07-18 Mobile Stock and Sales Cleanup

- Fixed Mobile takeaway checkout issues found during manual testing:
  - duplicate `orders_tenant_id_branch_id_order_no_key` when draft order numbers collided now retries the draft order number path.
  - stock deduction request IDs are made unique per ingredient to avoid `idx_stock_movements_tenant_branch_request_id` collisions.
  - mobile checkout RPC casts payment method text to `public.payment_method`.
- Improved receipt flow:
  - moved the print action to the receipt header next to close.
  - closing the receipt returns directly to `/sales`.
  - cash payment now warns immediately when received cash is lower than the payable total.
- Added realtime-style stock refresh for Mobile stock via `/api/mobile/stock`, polling/focus refresh, and recent stock movement display.
- Built Mobile sales list improvements:
  - `/orders` supports search/filter.
  - bill rows can open `/orders/[orderId]` to view bill details.
- Reworked Mobile stock screen:
  - product and ingredient lists use compact table-style rows.
  - list pagination currently shows 5 rows per page.
  - product category selection uses `product_categories` from the shared database instead of free text.
  - SKU/product code is no longer editable in the modal; new product codes are generated automatically by the API.
  - products and ingredients can be added, edited, and deleted/disabled; ingredient quantity can be adjusted.
  - the top product/ingredient control panel is sticky again per the latest request.
- Latest verification in `E:/SSTiPOSMobile`:
  - `npm run typecheck` passed.
  - `npm run lint` passed before the final sticky/pagination tweak; after that tweak, `npm run typecheck` passed.
- Notes for the next chat:
  - User is tired of repeated UI adjustments. Continue carefully and change only the exact requested item.
  - Current visual concern is the Mobile stock top card/sticky positioning; avoid broad redesign unless explicitly requested.
  - Do not drop or remove shared Supabase schema/table/column immediately; keep safe deprecate/compatibility flow.
