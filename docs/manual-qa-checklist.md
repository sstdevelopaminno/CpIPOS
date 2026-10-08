# CpIPOS Manual QA / Production Acceptance (2026-10-08)

> Perform on staging or an explicitly approved test tenant/device. Record **PASS / FAIL / BLOCKED / NOT APPLICABLE**, tester, time, tenant, branch, device, test evidence, and incident/ticket for each scenario. Never create real customer sales, change billing, or reset devices just to complete this checklist.
>
> **QR scan login was removed 2026-05-29.** Do not use legacy QR-login tests or defunct `/api/mobile/login/*` endpoints. Customer **Table QR ordering** is a different, supported workflow. Android Mobile uses the same server-controlled store/branch/employee/device login flow as Web POS.

## 1. Store login, staff permissions, session and device isolation
- [ ] Correct store code resolves the active tenant; invalid/disabled store returns an opaque rejection (no internal errors).
- [ ] Only active, assigned branches/devices may be selected. Cross-tenant, wrong-branch, revoked and unknown devices are rejected.
- [ ] Employee code / PIN / staff-card verification works where configured. Incorrect, replayed and expired login contexts are rejected.
- [ ] Owner, manager, cashier and Kitchen users see only permitted menus and APIs; server denies forbidden writes, not just hidden UI buttons.
- [ ] Repeated credential attempts are rate-limited across **different server instances**, with expected 429 and recovery; test unavailable central rate-limit backend safely in staging.
- [ ] Session expires, logout revokes it, branch/role/device updates take effect within the documented revocation bound.
- [ ] Tenant A never sees tenant B products, orders, payments, stock, reports, prints, chat or devices; repeat with branch A/B under one tenant.

## 2. Shift, counter sale, payments and recovery
- [ ] Sales blocked before authorized shift opening; staff can join a valid shift; shift close is blocked/reconciled for open bills.
- [ ] Counter sale handles quantity, modifiers, discounts, taxes, refunds/void approvals and correctly priced product bundles.
- [ ] Cash, bank transfer and configured QR/provider settlement store exact totals and receipt; customer payment notification follows transaction success.
- [ ] Retry network request with the **same** idempotency key: never double-create order/payment/stock movement.
- [ ] Failed or timed-out payment can be safely rechecked; paid order never becomes duplicated or re-payable.
- [ ] Print failure does not erase or retry the sale; queue remains observable and reprint requires correct permission.
- [ ] Shift close reconciles cash, transfer, cancelled bill and previous shift; report totals equal authoritative payments.
- [ ] After a completed payment the cart resets, receipt identifies the correct tenant/branch and access still requires a session.
- [ ] Simulate a network interruption at submission and payment; UI displays retry/recovery, not a permanent spinner.

## 3. Dine-in, Table QR, Kitchen and inventory
- [ ] Create, join, edit, transfer and close a table bill; concurrent cashier/table actions do not lose line items.
- [ ] Customer Table QR session expires when required, rejects tampered token, refreshes status correctly and does not auto-duplicate items.
- [ ] Verify POS and Table QR **both** honor `branch_inventory_settings.allow_negative_stock`: forbid when false, consistently allow when true.
- [ ] Ingredients/recipes and bundled items deduct stock only once; cancel/void restores according to branch policy.
- [ ] Kitchen routing sends correct branch/zone item, item cancellation and progress states; KDS reconnect must not duplicate tickets.
- [ ] Kitchen receipt printer prints exactly once for one ticket; timeout, retry, lease expiry, agent restart, paper loss and manual reprint are distinguishable.
- [ ] Physical printer acceptance: record printer model, LAN/Bluetooth/USB, OS, paper size, agent version, latency, output photo and acknowledgement.

## 4. Subscription, packages, quotas and Trial lifecycle
- [ ] Validate Starter/Growth/Business/Custom published prices and real commercial terms against live catalog.
- [ ] Disabled package features fail on APIs and UI. Quotas for branches/devices/users/products/bills cannot be bypassed with a direct API call.
- [ ] Check `mobile_app_enabled` versus contracted Mobile service **before** offering/installing Mobile on any paid plan.
- [ ] Trial expiration/grace/lock is reflected in Web/Android/Windows, with read-only billing and controlled settlement/unlock where appropriate.
- [ ] Billing period, renewal/due reminders, slip/payment approvals and reactivation never silently grant unpurchased features.
- [ ] Do not test Trial-to-Paid cutover until both data planes, server credentials and reversible migration plan are formally approved.
- [ ] Canary migration validates counts/checksums, object routing, orders, stock, payments, print, sessions and rollback **without** split-brain.

## 5. Device Manager, native platforms and offline
- [ ] Android Tablet Stable/Modern signing, APK hash, install, enrollment and owner/branch/device binding validated on actual target OS/OEM.
- [ ] MDM remote update only after explicit device eligibility; failed signature/hash/device scope must be rejected; rollback tested on a spare device.
- [ ] Windows installer, signed executable, local print bridge, controlled update and license entitlement tested on a supported Windows device.
- [ ] Android native Mobile login/cart/payments/session/shift/report respects the same server transaction and permission rules.
- [ ] Verify Web/Android/Mobile terminology and navigation for cashier, manager and owner.
- [ ] Do **not** mark offline cash sales or auto-sync as supported until order totals, payment reconciliation and duplicate prevention have real E2E evidence; a local IndexedDB queue alone is not sufficient.

## 6. Operations, release, security and evidence
- [ ] GitHub PR/release SHA matches Vercel Production commit and actual downloaded APK/installer versions.
- [ ] Supabase migration history reconciled by exact version on **both** Primary and Trial; no migration auto-applied based on missing version alone.
- [ ] Security review confirms `SECURITY DEFINER` ownership/EXECUTE/grants, RLS intent and branch/tenant checks, without broad public grants.
- [ ] Redis/Upstash rate limit verified in Production via **presence check only** of secret names and safe rate-test observations; no values in evidence.
- [ ] Backup + restore on isolated copy and Vercel rollback drill with measured recovery time and acceptance signoff.
- [ ] Multi-tenant mixed-load/soak test captures p50/p95/p99, queue age, DB pressure, API errors and device heartbeat.
- [ ] Production monitoring, alerts, escalation owner and incident runbook are demonstrated.
- [ ] Close GitHub Issue #74 only with physical print evidence and Issue #153 only with full production acceptance evidence.

## Final release authorization
- QA Lead / date:
- Engineering Lead / date:
- Operations / on-call / date:
- Approved tenant/branch/device scope:
- Recorded failures and remediation links:
- Approved exact release Git SHA:
- Decision: **BLOCKED** until all mandatory evidence above exists; do not infer production readiness from CI alone.
