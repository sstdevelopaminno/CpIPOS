# CUSTOM Recycling: authorized transaction correction (release design)
Status: draft, not production-ready. This branch implements only an isolated candidate for direct supervisor VOID; date/time and amount editing, shared Finance action and production migration are outstanding.

## Verified current behavior
- POS sales list row actions submit only date-correction-request, recording pending_accountant_review without applying the date.
- Existing VOID requires feature gates, active branch role, open shift, latest stock movement, no posted GL, non-bank settlement and verified physical cash/stock; self-approval is blocked.
- Finance recycling-income and recycling-expenses endpoints already read recycling_transactions with posted status and branch/tenant scope. Finance uses a separate signed session, not POS cookies.
- Receipt rendering checks line sums; VAT snapshots and issued tax invoices are immutable. Do not update just total_minor or created_at.

## Target behavior
Owner and authorized manager directly amend/cancel scoped bills, no accounting approval queue. Accountant with verified Finance identity and branch grant can use the same correction service. No staff edit. Both registers refresh from canonical transaction/revision data; no duplicate write or asynchronous accounting drift.
UI: shared modal, bill number, current lines, old/new quantity/price and total, effective document datetime in Asia/Bangkok, reason, preview of stock/cash/GL delta, save or cancel. Confirm settlement differences physically, never imply money actually moved solely from an edit. User's delete is audited VOID, hidden from active totals but retained in history.
Server: validate identity, branch/tenant, entitlement, role and explicit management permission; allowlisted fields, exact integer satang/micro-kg, request UUID and expected version. One SQL transaction, lock shift then source transaction then stock rows in deterministic order. Record immutable before/after, actor, source POS/Finance, action time and reason. No partial success. Keep original created_at and original receipt number for audit; separate document effective date/time. Return canonical version and refresh both views; filter and print by effective date/time, retain recorded timestamp.
Amount change: edit material lines and recalculate using existing calculation/tax rules, never independent overwrite of header. Apply inventory quantity and valuation, cash/AR/AP and GL adjustments with paired debit/credit entries; review subsequent stock costing and shift reconciliation. Posted journals use reversing/adjustment entries, not silent mutation; closed period and issued tax invoices use controlled dated adjustments and appropriate credit/debit notes, no approval queue for authorized actor but retain required evidence. Bank settlement requires verified evidence. Fail closed until these atomic workflows are tested.
Rollback: keep previous deployed code, compatible schema migration, revert feature gate; do not erase already committed legitimate corrections. No production database changes in this draft.

## Acceptance matrix
- Owner and manager can void their own eligible receipt; staff/accountant self-void remains denied by this candidate; independent authorized accountant can use existing eligible VOID.
- Cross-tenant and unauthorized branch rejection, expired session, inactive roles.
- Correct buy/sell amount from each UI; identical new total, line sum, stock, cash/credit, receipt and Finance after reload.
- Change date and time in Bangkok, verify daily/monthly filters on both sides, audit original timestamp.
- Duplicate request and conflicting revisions cannot apply twice; forced failure rolls back all effects.
- Closed shifts, later stock movements, posted GL, VAT issued, bank transfer: reject or execute proper adjustment atomically; never bypass controls.
- VOID: active reports exclude cancelled bill, audit/history retain it and no receipt number reuse.
- No effects in normal POS, other tenants or unrelated finance expenses; CI, build, synthetic PostgreSQL UAT and staging device tests required before release.
