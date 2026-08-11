# Table Management UI/UX Cleanup — 2026-08-11

Scope: system-wide Web POS Table Management. The Android/POS terminal is a primary test device only; behavior must remain shared across supported POS clients.

## Delivered

- LIST view uses one visual owner frame instead of nested `.surface` + center + list borders.
- Search/filter toolbar, table rows, and pagination are separated with internal dividers.
- LIST table body has bounded vertical scrolling and returns to the top when the page changes.
- LIST pagination uses 10 tables per page and keeps Previous / page count / Next visible even on a single page.
- Existing LIST sorting, search, branch selection, edit, delete, and BOARD view remain in place.
- Added `+ เพิ่มหลายโต๊ะ` / `+ Bulk add tables` workflow.
- Bulk presets: 5, 10, 20 tables; custom count supports 5–100.
- Bulk fields: branch, zone, seats, start number, prefix, and table-name mode.
- Bulk modal previews the first generated tables before submission.
- Bulk API validates branch scope, management role, zone ownership, numeric limits, prefix, and duplicates.
- Bulk insert is issued as one PostgREST array INSERT so a database failure rolls back the statement rather than leaving a partial batch.
- Bulk-created BOARD positions are seeded on a simple 6-column grid so new tables do not all overlap at coordinate 0,0.
- One `table_bulk_create` audit event is written per successful batch.

## Main files

- `apps/backoffice-web/src/components/tables/table-list-grid.tsx`
- `apps/backoffice-web/src/components/tables/table-bulk-create-button.tsx`
- `apps/backoffice-web/src/app/api/backoffice/tables/bulk/route.ts`

## Safety / invariants

- No database migration is required.
- Existing unique constraint `(tenant_id, branch_id, table_code)` remains authoritative.
- Client-provided branch scope is revalidated server-side.
- Owner/manager table-management permission remains required for bulk creation.
- Existing BOARD data loading remains full-list; pagination is a LIST presentation concern so floor-plan behavior is not paginated accidentally.
- Production test data was not inserted as part of implementation validation.

## Manual acceptance checks

1. Open `เพิ่มเติม > จัดการโต๊ะ` and verify LIST has one outer content frame.
2. Confirm `ก่อนหน้า / หน้า 1 / 1 / ถัดไป` appears with fewer than 10 tables and end buttons are disabled.
3. With more than 10 tables, verify page 2 appears and the list scroll resets to the top on page change.
4. Verify search/sort still reset LIST pagination to page 1 through table-list data changes.
5. Open `+ เพิ่มหลายโต๊ะ`, select 5/10/20 or custom 5–100, and inspect preview.
6. In a disposable/test branch, create 5 tables and verify LIST refresh, codes/names, zone, seats, and BOARD placement.
7. Attempt a duplicate range and verify the entire batch is rejected with no partial creation.
8. Switch LIST -> BOARD -> LIST and verify existing floor-plan editing remains functional.
