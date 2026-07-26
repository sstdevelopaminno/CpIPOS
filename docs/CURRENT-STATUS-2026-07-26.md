# Current Project Status

Date: 2026-07-26

This is the current handoff pointer for SST iPOS. Use this file before older audit notes when deciding what is active.

## Active Scope

- Main runtime: `apps/backoffice-web`
- Login flow: `/login/store -> /login/branches | /login/employee -> /login/devices -> /preview/pos`
- Database: Supabase migrations through `supabase/migrations/202607180007_stock_realtime_publication.sql`
- Historical QR login docs remain archived and should not guide new implementation unless cross-checked against current code.

## Current Fixes

- Local workspace for all Web POS work is `E:\SSTiPOS` only. Do not create or develop from a parallel `SSTiPOS-webpos-current` copy.
- Local Git repo was restored from `https://github.com/sstdevelopaminno/SSTiPOS.git`, branch `agent-docs-preflight-schema-drift`, commit `cdb3f63` (`Show POS member details on bills`).
- Tracked source files currently match `origin/agent-docs-preflight-schema-drift` at `cdb3f63`; no local tracked code patch is pending after restore.
- `/login/store` code at `cdb3f63` includes the current Vercel/GitHub-style login UI: centered `store-v2` card, language switcher, CpIPOS logo, masked store-code input, and visibility toggle button.
- Admin POS monitor cache is now keyed by the authorized branch set instead of `auth.userId`, so users with the same permitted branch scope can share cached snapshots without crossing authorization boundaries.
- Admin POS monitor cache TTL is now 30 seconds.
- Admin POS monitor branch fan-out concurrency is reduced to 2.
- Admin POS monitor route-performance scan sample is reduced from 500 rows to 200 rows per branch.

## Verification

Run on 2026-07-26 after dependency install:

- `Select-String` check confirmed `/login/store` has `showStoreCode`, `EyeIcon`, `login-code-visibility-btn`, and `store-v2-input-box-with-toggle`.
- Vercel CLI project list confirmed project `sstipos`, production URL `https://sstipos-ten.vercel.app`, Node `22.x`.
- `vercel ls sstipos` confirmed recent Preview deployments are failing with `Error`; check Vercel build logs before promoting a new deployment.
- `git status -sb --untracked-files=no`: clean on `agent-docs-preflight-schema-drift...origin/agent-docs-preflight-schema-drift`.
- `pnpm --filter backoffice-web typecheck`: passed
- `pnpm --filter backoffice-web lint`: passed with 3 existing React hook dependency warnings in `src/components/pos/pos-sales-module.tsx`
- `pnpm --filter backoffice-web test`: passed, 25 files / 62 tests
- `pnpm --filter backoffice-web build`: passed

## Remaining Priority Risks

- `/api/pos/session/current` can still synthesize an open shift when shift lookup times out. This should be changed to a degraded/retry state before production traffic.
- Employee-code login still scans branch roles before checking `pos_user_profiles.employee_code` directly. This should use the indexed profile lookup first.
- `TABLE_QR_SIGNING_SECRET` should be mandatory in production instead of falling back to `SUPABASE_SERVICE_ROLE_KEY`.

## Read First

- `context.md`
- `README.md`
- `docs/PRODUCTION-DEPLOYMENT-OPERATIONS-INDEX.md`
- `docs/system-stability-audit-2026-06-04.md`
- `docs/POS-SHIFT-CLOSE-RELIABILITY-2026-07-10.md`
