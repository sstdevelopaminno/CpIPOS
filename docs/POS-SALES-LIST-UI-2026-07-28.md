# POS Sales List UI 2026-07-28

## Scope

- Page: `apps/backoffice-web/src/components/pos-preview/pos-sales-list-workspace.tsx`
- API: `apps/backoffice-web/src/app/api/pos/sales-list/route.ts`
- Service: `apps/backoffice-web/src/lib/services/pos-sales-list-service.ts`

## Changes

- Added `Export CSV` to the main `รายการขาย` toolbar.
- CSV exports only the visible table page, not KPI cards and not hidden detail data.
- Export uses the shared Excel export helper and downloads an Excel-readable `.xls` HTML table with UTF-8 metadata and BOM. This prevents Windows Excel from opening Thai text as ANSI mojibake and keeps table columns stable.
- Edit now opens a real edit popup after manager/owner PIN approval, instead of cycling local state.
- Delete now calls the sales-list API after PIN approval and soft-hides the order with `metadata.sales_list_deleted = true`.
- Sales-list loading filters out rows marked `sales_list_deleted`.
- Live refresh now pauses while a detail, filter, PIN, or edit popup is open and polls every 5 seconds instead of every 2 seconds to reduce API pressure and UI state jumps during staff actions.

## Guardrails

- Do not hard-delete historical sales orders from this page.
- Keep edit scope limited to bill status, payment method, and note unless a new audited accounting workflow is designed.
- Owner/manager actions require `manager_pin_approvals`; IT admin can bypass PIN through role check.
- Preserve tenant and branch filters on every API write.

## Verification Notes

- Run `corepack pnpm --filter backoffice-web typecheck` after changes.
- Run `corepack pnpm --filter backoffice-web exec vitest run tests/integration/excel-csv.integration.test.ts` when changing export behavior.
- On the follow-up round, the user explicitly requested commit, push, and deploy after verification.
