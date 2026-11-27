# CUSTOM Retail & Wholesale (RW) — staged release

## Phase 1/2: compatible profile foundation

Explicit IT contract metadata sales_modes.retail_wholesale=true, general_sale=false, CUSTOM only, no other selling modes. The runtime-only SD engine projection is returned in legacy sales_modes; selected_sales_modes describes the actual licence. Legacy dual-flag contracts remain readable. No new SD licence is required. Existing SD stores and fixed packages remain untouched. Reuse the authenticated SD cashier, scanner, shifts, receipts, held bills and payment engine. Never infer the RW grant from the tenant name. IT console changes are a separate repository release. Do not activate a live tenant until both releases and authenticated UAT pass.

## Phase 3: commercial pricing and units

The isolated integer-satang quote function is a tested foundation only, not a live checkout price authority. Next: branch-scoped product units and tiers; server-authenticated catalog revision, unique barcode, rational/whole conversion, effective dates; price resolution and immutable snapshot in an atomic checkout RPC. Reprice or reject stale cart/offline requests; never trust a client price, and do not mutate ordinary SD catalog prices.

## Phase 4: purchasing and credit

Add RW-specific purchase orders, goods receipts, supplier/customer master references, lot and branch transfers, stock counts; separate PO approval from receipt. Credit requires verified customer, limit and due date, idempotent settlement, AR balance and payment allocation. Inventory, cash and credit changes must commit atomically; no dummy payments or manual balance edits.

## Phase 5: Finance

Reuse existing Finance role/package access and the canonical document/GL ledger. Map sale/purchase, receipt, payable/receivable, VAT, weighted average COGS, cancellation/reversal and tax documents to journal source IDs. A posted journal must balance and preserve audit history. No automatic GL posting until exact schema/RPC contract and reversal/idempotency UAT pass. Reconcile real legacy records without rewriting historical order IDs.

## Phase 6: release gates

CI/typecheck/lint, regression against standard SD and other CUSTOM modes, branch/tenant negative cases, PostgreSQL synthetic UAT for stock/AR/AP/GL, authenticated real-session test without creating customer transactions, physical scanner/printer test. Deploy POS and IT compatible code before enabling the explicit profile, and keep ability to disable RW while SD remains available. No production migration in this foundation release.
