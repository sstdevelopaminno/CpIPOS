# POS Sales Summary UI 2026-07-28

## Scope

Updated `/preview/pos/sales-summary` in `apps/backoffice-web/src/components/pos-preview/pos-sales-summary-dashboard.tsx`.

## Changes

- Moved KPI cards from the main page into a `สรุปยอดขาย` popup button placed before `คัดกรอง`.
- Main page now starts with the shift summary table, reducing vertical clutter and UI load.
- Replaced the fixed `.slice(0, 12)` shift table limit with pagination.
- `Export CSV` now exports only the visible `สรุปกะ` table page instead of exporting all sales rows from a different dialog.
- CSV export now uses the shared Excel CSV helper: UTF-16LE BOM, `sep=,`, CRLF line endings, quoted cells, formula escaping, and language-specific headers. This is more reliable for Thai text in Windows Excel than plain UTF-8 CSV.
- The `ดูเพิ่มเติม` popup now has an `Export CSV` button on the right side of the header. It exports only the active tab table: payment methods, best-selling products, or cashier performance.
- The `รายการขาย` popup also has its own `Export CSV` button and exports all visible columns in that sales-row table only.
- The `ดูเพิ่มเติม` export button now shows the active table name, so staff can verify which table will be saved before clicking.
- Added `tests/integration/excel-csv.integration.test.ts` to protect Thai text, column separators, formula escaping, and UTF-16LE BOM behavior.

## Printing Note From Attached Spec

The attached print-agent prompt is an architecture spec, not a runnable shell command. Current repo already has printing docs and adapters in:

- `docs/PRINTER-ARCHITECTURE.md`
- `docs/BLUETOOTH-BRIDGE-SETUP.md`
- `docs/BLUETOOTH-BRIDGE-API-SPEC.md`
- `apps/backoffice-web/src/lib/printing/*`

Do not invent printer BLE UUIDs, COM ports, or vendor SDK details. Future work should extend the existing bridge/queue model toward the requested Windows local agent only after exact printer hardware is known.
