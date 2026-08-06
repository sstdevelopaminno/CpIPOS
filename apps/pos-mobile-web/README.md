# SSTiPOSMobile

Mobile-first Web App/PWA for SSTiPOS store owners, managers, and staff.

## Setup
```powershell
pnpm install
Copy-Item .env.example .env.local
npm run dev
```

## Environment
Use the same Supabase project/database as `SSTiPOS` and `SSTiPOSSupport`. Do not create a second database and do not commit real secrets. Required names are listed in `.env.example` and `docs/vercel-env-checklist.md`.

## Commands
```powershell
npm run dev          # live reload for UI/system development
npm run dev:next     # same safe dev runner, kept for old habit
npm run dev:raw      # raw Next dev without auto cache restart, debug only
npm run dev:stable   # production-like local run after npm run build
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run dev` and `npm run dev:next` use `scripts/dev-safe.mjs`, which clears `.next` before startup and automatically restarts the dev server if the known Next dev manifest/cache errors appear (`segment-explorer-node`, `React Client Manifest`, `__webpack_modules__`, `/_app`, missing chunk `./87.js`, `fallback-build-manifest.json`, or `.next` ENOENT runtime cache errors). Use `npm run dev:raw` only when debugging Next itself.

Stop the dev server before running `npm run build`; dev and build both write `.next`, and running them at the same time can produce missing page/chunk errors.

## Authentication Flow
`/login/store -> /login/branch -> /login/employee -> /login/device -> /shifts -> /sales`

The server resolves tenant, branch, user, role, cashier device, POS session, shift and feature state from the shared SSTiPOS Supabase database. Client-submitted scope is never trusted. After cashier device selection, the operator opens the device shift from `ปิดยอด`; once the shift is open, the app enters the `ขาย` menu. `/dashboard` is kept only as a compatibility redirect to `/sales` or `/shifts`.

## Mobile UI Notes
The POS bottom navigation keeps the existing five route/permission-controlled menu items (`ขาย`, `รายการขาย`, `สินค้า`, `ปิดยอด`, `ตั้งค่า`). The center `สินค้า` action sits inside an integrated U-shaped concave notch in the bar; it is not a floating or detached center button.

Takeaway receipts use the store `logo_url` when available. If a store has no logo or the image fails to load, receipts fall back to the full system logo at `/brand/cpipos-logo.png`.

The sales home bell shows a red unread dot when shift/order/product readiness notices are available. Tapping the bell opens the in-app notification list and marks the current notices as read on that device.

The sales shortcut row includes `รายการพัก` and a square `สมาชิก` action beside it. Sales mode cards use a consistent Lucide icon set for takeaway, table, and delivery entry points.

The `สินค้า` page uses a clean responsive table-like product management UI with no product photos or row numbers. It keeps the existing tabs, search, pagination, add/edit/delete actions, and stock data source.

When an operator closes a cashier shift from `ปิดยอด`, the app saves the closing cash/summary to the shared `shifts` table, revokes the current POS session, and returns to branch selection.

Takeaway `พักบิล` uses the shared hold RPC when available, with a server-side scoped table fallback so draft bills can still be held in the existing `orders`/`order_items` schema.

The sales home keeps the compact CpIPOS symbol-plus-text brand mark. Its `สินค้าพร้อมขาย` card opens `/sales/stock-readiness`, showing today's sales, orders in the current shift, active products by category with 5-item pagination, ingredient stock quantities, and latest shift orders.

## Deployment
Production alias: `https://sstiposmobile.vercel.app`

Before production login tests on Vercel, set the required Supabase and mobile session env vars in Vercel Project Settings. See `docs/vercel-env-checklist.md`.

## Known Limitations
- Sales write flow currently covers takeaway draft bills, held bills, cancellation, and cash/transfer checkout. Table and delivery sales remain placeholder entry points.
- Vercel runtime database login requires production env vars to be configured in Vercel Dashboard.

## Smoke Test Account
Use the shared SSTiPOS dev/production database test path after env is configured:

`NDL-TH-001 -> NDL-ONNUT-01 -> sst182536 -> cashier device -> open shift`
