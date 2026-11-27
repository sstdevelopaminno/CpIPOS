# Integration checkpoint — 2026-11-27

Draft only. Main baseline 65fae75b255df7f635babb64ca9b3a938c02d268; previous draft 7f10da6c3ac11794d173f13216bc60273bbd19b1. Retain current main receipt printing, direct date correction and cashier date APIs. Do not install obsolete manual/shared document time or effective GL candidates: superseded by #571 and #573. The old shared clock files are superseded by the current cashier implementation; #575 remains independent and needs reconciliation before release. Amount editor uses RECYCLING_DIRECT_DATE_EDIT_ENABLED plus RECYCLING_AMOUNT_CORRECTION_ENABLED. Held carts preserve the fixed document timestamp and reason; restore checks current permission and timestamp. Synthetic workflow installs remaining correction candidates after main tests and uses the actual direct-date RPC in the amount fixture. No candidate DDL may be applied to production until reviewed.

Outstanding: arbitrary price changes (current-price guard still enforced), repeat historical replay, cash/transfer settlement, multiple historical lines, effective readers, tax note print/report, authenticated UAT, CI and schema review. Historical credit candidate currently refuses repeated corrections by product and does not expose write RPC. Do not claim complete or merge until release gates pass.

---

# CUSTOM Recycling: authorized transaction correction (release design)
Status: draft, not production-ready. The branch now includes isolated supervisor VOID and shared date/time correction SQL candidates, gated POS and Finance correction endpoints, common date/time editor, effective document time in POS document registers, Finance income/expense registers and non-tax receipt rendering. Original created_at and shift chronology remain intact. Both features are disabled in production; do not enable until migration, period/VAT and end-to-end UAT are complete. Amount/quantity corrections, posted GL adjustment, historical stock valuation, VAT adjustments, and production migration are still outstanding. The date correction candidate refuses posted GL and VAT documents; the Finance overview/cash reconciliation continues to use actual posting chronology.

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
