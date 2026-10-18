# CUSTOM Optical: CRM → Existing POS Cart → IT controls
## Source-code preflight / handoff — 2026-10-18

**Status: AUDIT ONLY.** Not a production feature implementation, migration approval, or bank-payment verification. The full work-order checkout cannot go live until isolated schema/RLS tests, automated and actual-device E2E, and deployment rollout checks pass. Preserve STARTER/GROWTH/BUSINESS and other CUSTOM modes.

### Verified repository paths, current draft heads
- POS branch `fix/optical-crm-it-rls-20261018`, PR #295: `apps/backoffice-web/src/components/pos/pos-sales-module.tsx`, `pos-general-sale-table-controller.tsx`, `pos-optical-deposit-dialog.tsx`, `app/api/pos/optical/work-orders/route.ts`, `app/api/pos/optical/work-orders/recall/route.ts`.
- CRM branch `fix/optical-report-ui-and-tablet-20261018`, PR #36: `src/App.tsx`, `src/views/OpticalCustomersView.tsx`, `src/views/OpticalOperationsView.tsx`, `src/lib/optical-work-order-domain.ts`.
- IT branch `feat/optical-api-module-controls-20261018`, PR #151: `apps/backoffice-web/src/lib/crm-menu-policy.ts`, `components/it-admin/tenant-crm-menu-policies.tsx`, `app/api/it-admin/v1/tenants/[tenantId]/crm-menu-policies/route.ts`.

### Existing POS cart: MUST REUSE, do not create another
1. `pos-sales-module.tsx` owns `cart`, `cartRef`, `setCart`, `addCartLine()`, `removeFromCart()`, `adjustQty()`, `renderCartList()`, `renderCartContent()`, `handleCheckout()`. The mounted `PosCartPanel` and `PosCartDrawer` already handle wide and narrow layouts.
2. CUSTOM Optical `addToCart()` calls `addCartLine(product)` directly; restaurant ingredient modifiers are skipped. Keep normal, non-work-order Optical sales behavior unchanged.
3. `pos-general-sale-table-controller.tsx` already provides the Optical-specific responsive item table, scanner idle/paste/Enter handling, SKU lookup and `GENERAL_SALE_ADD_PRODUCT_EVENT` → React cart bridge. Keep existing scanner/card layout, not a second UI.
4. The second Optical bill scan field currently calls `copy.billDisabled` on submit: it does **not** load a work order. `GET /api/pos/optical/work-orders/recall` is **deposit-specific**, rejecting orders with paid_total <= 0. Do not use this as the new ordinary CRM work-order lookup.
5. The existing Optical product scanner calls `GET /api/pos/products/lookup`, whose stock visibility checks `recipes` and `branch_inventory_settings`. It does **not** verify that this work order reserved the Optical `optical_stock_bins` units. A CRM-origin checkout therefore needs an order-scoped verification endpoint rather than a blind product add.
6. The cart's normal `handleCheckout()` builds a generic POS order, while `submitOpticalCashDeposit()` creates a **new** Optical work order and deposit atomically. A recalled CRM work order MUST NOT use either of these unmodified, otherwise a duplicate sale or duplicate reservation can occur.

### Integration contract (new code, not yet implemented)
- One **authoritative work_order_id** and immutable line snapshot per issued CRM work order. Do not create a second `optical_work_orders` row on POS checkout.
- Two input types: (A) `work-order locator barcode` identifies the invoice without authorizing payment; (B) ordinary `SKU/unit barcode` verifies physical item matches `optical_work_order_lines`. Work-order barcodes must not be silently interpreted as SKU. Never encode customer medical details in a barcode. Explicit validation of prefix/version, tenant, branch, session, role and order status on the server.
- A successful authorized lookup clears/replaces the cashier's **uncommitted** existing cart only with confirmation if nonempty. Add `cartSource = manual | optical_work_order` and order id + server order version in POS state. Render through existing `PosCartPanel`, `PosCartDrawer` and Optical table; never mount a duplicate cart.
- When `cartSource=optical_work_order`, item rows reflect the authoritative order-line quantity/unit price/discount, not current catalog price. Scans update **verified quantity**, not cart quantity or order subtotal. Disable direct quantity/discount/product mutation for linked carts; changes go back through authorized CRM work-order revision before payment. Reload/expire the link on branch/session switch.
- Item verification must match line product, reserved `stock_bin_id`, expected quantity, and optional unique unit barcode when implemented. Do not treat duplicate scan of the same serial as another item. Mismatch shows an error and makes no payment/stock mutation. If no serialized label exists, repeated matching SKU scans may verify counted units; enforce correct count.
- Preserve the current `received → lens_ordered → edging → ready_for_pickup → collected` status rules and stock reservation lifecycle. CRM draft should be a separate pre-issuance entity or reviewed schema change: live `optical_work_orders` has no `draft` status.
- A dedicated **full-settlement** endpoint/transaction (not the current deposit create endpoint or generic POS checkout) locks the order and reservations, checks current tenant/branch, role, shift, payment currency LAK, IT API toggle, order version, all scanned line quantities, original total/paid_total, payment evidence and idempotency request key. Atomic state transition prevents repeated stock deduction. If payment has already occurred, return existing immutable receipt without posting again.
- Existing `optical_transition_work_order_tx` deducts reserved stock at `collected`. A new settlement API must coordinate with that invariant; never decrement inventory twice. A work-order payment can be recorded while still in production; collection happens only at appropriate work-order status, full balance and correct physical handover.
- Full settlement **without initial deposit** is primary: initial paid_total=0; no requirement for existing positive deposit; if a pre-existing order already has recorded deposits, settlement must credit only remaining balance, never charge order total twice. Transfer bank-credit verification is manual until external reconciliation exists; never claim automatic proof.
- CRM prints a **work-order** barcode on its job sheet; POS prints a financial receipt only after server-confirmed ledger posting. These are separate artifacts.

### CRM work-order editing/deletion safety
- Existing `OpticalOperationsView.tsx` reads order table and payment history; lacks create/edit/delete/print UI. `OpticalCustomersView.tsx` already owns customer/exam history.
- New CRM issuer flow: select authorized customer/exam snapshot, choose reserved Optical stock, set appointment/seller/notes, save draft, issue order via server-validated transaction. CRM Vite frontend must never receive service_role; the existing stock-reserving create RPC has service-role-only EXECUTE.
- Staff receptionist role needs **specific** permissions for customer/exam entry and issuing drafts. Current DB `can_manage_optical_customer_data` allows only Owner/Manager and is used by customer/order RLS. Must change only Optical role/permission logic; do not open branch data by broad authenticated table grants.
- Draft: edit or delete. Issued: versioned amendments before payment as explicit atomic cancel/re-reserve or issuance revision. Paid/collected: prohibit hard deletion; use controlled cancellation/refund plus ledger/audit, never remove evidence. All mutations tenant+branch scoped and idempotent.
- Customer examination history should be snapshotted for the order and preserved despite later customer changes. Do not expose medical fields in barcode.

### IT control and release gates
- Existing PR #151 includes `main.crm_optical_orders` and tenant API kill switches `settings.crm_optical_api_work_orders`, `...deposits`, `...inventory`, `...customers`, `...payment_verification`. These are DRAFT and are not active on Production.
- Introduce independently testable capabilities for `optical.work_order.create/edit/print/cancel`, `optical.checkout.lookup`, `optical.checkout.verify_item`, `optical.checkout.full_settlement`. A UI menu toggle alone is not authorization; enforce in trusted BFF/DB and audit IT toggle changes.
- IT and package controls must be ANDed: CUSTOM Optical sales mode, applicable custom_features, tenant/branch, role, active POS shift, LAK settlement and deployment rollout. Missing finance approval MUST fail closed. Never alter fixed-plan menus or route writes into shared restaurant order/ingredient flows.
- Existing PR #295 RLS migrations have **not** been applied. RLS changes must be tested in an isolated/dev DB branch before merge; do not create a new potentially billable Supabase branch without permission.

### End-to-end acceptance before enabling
1. Staff A (CRM) selects existing customer and eye exam, creates work-order draft and issues one order. One order id, reserved stock, generated print locator; no ledger write.
2. Staff B (POS) enters the existing Optical mode, scans order code into the existing cart; wrong tenant/branch/user/expired order denied. Preexisting manual cart not silently lost. No duplicate work order.
3. Scans frame/lens/product separately; correctly matched reservation units increment **verification** only. Repeated/unknown/unreserved/other-branch barcode rejected. Existing Optical cart layouts and non-order scanner unaffected.
4. Full payment only after all required scans, session/shift/IT grants; accurate outstanding LAK with or without earlier deposit. Retry same idempotency key posts exactly once. Stock reservation is released/deducted only once at permitted transition.
5. Receipt and CRM status/ledger update reflect the same order; no erroneous cash/transfer confirmation; no exposure of eye exam on QR/barcode.
6. Test tablet portrait/landscape/mobile, slow HID scanners/no Enter/paste, offline/retry/concurrent cashiers, CRM edit during checkout, cancellation/refund, permissions, Stock=0, owner vs receptionist vs cashier, and regression on Starter/Growth/Business.
7. Complete CI, isolated SQL apply/rollback with RLS/advisors, synthetic E2E and actual device smoke test; keep all PRs Draft and all Production flags OFF until gates clear.
