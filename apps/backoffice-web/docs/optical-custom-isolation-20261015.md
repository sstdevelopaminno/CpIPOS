# IMDC OPTICAL / CUSTOM — isolation and staged rollout contract (2026-10-15)

## Baseline (verified from production source/schema)
- Keep POS, IT Admin and CRM as **one tenant-scoped platform**, not three independent data stores. All Optical features require the IT-approved `CUSTOM + sales_modes.optical_retail` entitlement for the current **tenant**, and branch/role scope for each read or write. CUSTOM **alone** never enables optometry.
- Existing `optical_customers` and `optical_eye_exams` already exist with tenant+branch and RLS; CRM has OpticalCustomersView; POS customer examination API invokes `optical_save_customer_exam`. Eye exams are history, not overwrite of the previous exam.
- Existing `orders/order_items/payments`, `create_pos_order_tx`, `complete_pos_payment_tx`, `recipes/ingredients/stock_movements`, kitchen ticket routing, cashier shifts, receipt printing and audit are **shared with restaurants**.
- Existing full-payment transaction insists payment amount == order total and marks the order `completed`. It does **not** implement partial deposits and MUST NOT be reused for them.
- The `order_items` insert trigger invokes `app.route_inserted_order_items_to_kitchen` for any inserted item. Before enabling Optical work-order items, establish an explicit server-verified Optical transaction marker or safe order-kind-specific route exemption; never disable kitchen routing globally.
- HTML receipt renderer already has an 80mm layout. Deposit slips require a distinct committed-payment snapshot, not a fabricated completed sale.
- Current QA item `QA-LAK-FRAME-001` is recipe-backed with a unit mapping of one ingredient per frame. Bypassing the food modifiers UI **does not remove** its recipe stock accounting.
- USD/Tender support is a separate milestone; no automatic FX conversion of THB history or old catalog prices.

## Contract boundaries (no changes to restaurant path)
1. `optical_retail` controls only the Optical UI and customer/work-order APIs. Future `optical_deposit`, `optical_work_orders`, `optical_inventory` should be independently disabled-by-default IT grants; enforce in server routes, not only hidden buttons.
2. Optical work-order metadata and stock reservation are new **additive** tables scoped by `tenant_id`, `branch_id`, referencing the existing customer/exam and product catalog. No changes to common recipe deduction unless behind an explicit Optical-only adapter and reviewed transactional migration.
3. Financial deposits use a new immutable **Optical payment ledger** with rows `order_id,tenant_id,branch_id,currency_code,amount,method,request_id,received_at,received_by` plus a unique scope-bound `request_id`. A backend RPC must lock the bill and reconcile the ledger in one transaction; paid/cancelled/void bills reject further money. Never re-label old payments or create extra `completed` orders.
4. Exactly-once stock: choose a documented `reserve_on_order / deduct_on_pickup` or `deduct_on_payment` policy. Reservations are not equivalent to stock movements. Reversals/cancellations must be audited, idempotent and correct even under two concurrent operators. The existing restaurant `deduct_order_recipe_stock` remains untouched.
5. 80mm deposit receipt prints **only after** ledger confirmation, includes original total, cumulative paid, outstanding, receipt id and QR locator for pending partial balance. The QR does **not** contain patient data, confer authentication, or authorize payment. A server lookup checks tenant/branch/user permissions and live ledger/status.
6. Standard fully-paid POS receipt contains **no outstanding recall QR**. A completed work order may still have a normal pickup code, but must never re-open payments.
7. Owner-only report/edit access is existing hashed secret + server-side RBAC, not a literal customer-provided PIN embedded in source or browser code.
8. Customer profile is still missing structured address, and no Optical-specific frame/lens metadata or work-order tables are deployed. Additive fields/migrations and RLS require a separate QA release.

## Release gates
- **Stage A: present draft PR #276:** pure Optical deposit validity, recall QR locator, safe 80mm preview; no DB/schema/endpoint/print/live-payment modifications.
- **Stage B: additive DB migration and secured RPC** only after review of exact order and inventory lifecycle. Prove RLS and two-client concurrency on a disposable Supabase branch first, preserving production transaction history.
- **Stage C: isolated POS and CRM screens** for work orders, frame/lens stock, patient history, reports, two salespeople; all tied to the single tenant/branch record, with no duplicate customer database.
- **Stage D: sandbox browser E2E** in QA 900001: 1000 LAK bill -> 500 LAK deposit -> printed QR -> retrieval -> 500 LAK final -> exactly one stock deduction/pickup, 2 ledger rows, no double payment. Reject >500, cancelled, void, paid, cross-tenant lookup, duplicate request/parallel payments. Confirm 80mm print; test customer data privacy.
- **Stage E: restaurant regression** (takeaway, dine-in, buffet, kitchen tickets, table QR, full payments, cancellations, stock, shifts, 58mm/80mm receipts, non-CUSTOM rights), plus non-Optical CUSTOM. Deploy under a QA-only feature flag, verify Vercel runtime and permission behavior before any real store authorization.

**No data cleanup, schema modification, feature activation, or production sales made as part of PR #276.**
