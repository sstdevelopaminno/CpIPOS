# CpiPOS Finance — Compact ERP-inspired Workbench (17 November 2026)

## Design reference and UX decisions
Owner provided two examples of legacy accounting software with top-level functional
navigation, secondary blue ribbon, form filters above dense transaction tables,
compact button styling and visible row/status hierarchy. This implementation
adapts those patterns to the existing CpiPOS blue brand rather than copying
the other software's logo, product identity or exact screen.

## Navigation
The same FinanceSalesDashboard component runs at:
- Owner: `/preview/pos/finance` with existing POS Owner session and authorized owner branch grants.
- Accountant: `/finance` with purpose-separated Finance-only session and tenant-wide Accountant branch grants.
- Both require server-side Business/CUSTOM entitlement and IT `main.finance` enabled.

Functional Finance ribbon tabs:
- ภาพรวมการเงิน — summary by currency, daily trend, receipt channel breakdown and sales grid
- รายรับจากการขาย — full read-only sales ledger grid
- สรุปตามสาขา — branch/currency totals
- ช่องทางรับชำระ — paid payment method totals
- ตรวจสอบยอด — sales grid with mismatches selected by default

## Filters and commands
- Bangkok date from/to (31 days maximum), authorized branch selector, bill number search,
  paid payment channel, reconciliation status, page size 20/50.
- Search applies the draft inputs; Today / 7 days apply date range directly; reset clears.
- Server validates all filter values and returns paginated rows from the FULL bounded
  authorized period (not an arbitrary last-50 preview). Each page is numbered,
  with next/previous controls and empty-search states.
- Refresh is a fresh authenticated GET with no-cache. Export CSV downloads only the
  **currently visible page**. No misleading claim of an all-period, tax or official ledger export.
- CSV escapes double quotes and prefixes formula-like values to prevent spreadsheet
  interpretation of untrusted order numbers or branch names.

## Data integrity and constraints
- Summary depends on date and branch, **not** the table's bill/channel/reconciliation filters.
  The screen labels this distinction explicitly.
- Completed bills only, linked paid payments only, and de-duplicated payment IDs.
  The table includes payout mismatch and missing paid payment evidence.
- Currency separated, no conversion, no computed profit, no tax invoice generation.
- Supabase payment results with potential API row caps are detected and fail closed.
- Date+branch scope, tenant, role and package are enforced on server for every request.
- Authoritative sale counts are capped at 3,000 for a requested time window.
  Rather than returning silently truncated financial totals, an oversize report asks
  the user to narrow the requested dates.

## Release gates
- Keep PR #479 on its existing branch until complete CI and test-account browser UAT.
- Do not introduce write authorization or modify historical POS sales.
- Verify Owner and Accountant experiences in a test tenant, including mobile widths,
  an empty date range, duplicate payments, role revocation and unauthorized branch access.
- Production screenshot of the old placeholder means PR #479 code is not yet deployed;
  it does not prove the new API returns zero.
