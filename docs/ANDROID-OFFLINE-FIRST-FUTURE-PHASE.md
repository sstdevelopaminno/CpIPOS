# Android Offline-First Future Phase

Date: 2026-08-02
Status: Documentation only. No production code changes.

## Purpose

Define the future offline-first architecture for the CpIPOS Android 13+ fullscreen APK runtime without implementing it now. Offline mode must be treated as a later phase because it affects orders, payments, inventory, tenant boundaries, and synchronization safety.

The first Android APK phase should be online-first WebView shell only. Offline sales, local database, and sync engine must not be added until the online runtime and native bridge contracts are reviewed and stable.

## Current CpIPOS Behavior To Preserve

CpIPOS currently uses server-side APIs and Supabase-backed persistence as the authoritative source for POS operations. Server-side rules enforce:

- tenant isolation
- branch scoping
- user role and permission checks
- active POS session and shift requirements
- server-calculated order totals
- feature gates and quotas
- audit logging for sensitive actions

The offline phase must not weaken these rules.

## Proposed Architecture

Future offline mode should use a local Android database and a sync engine:

```text
Android WebView UI
  -> existing CpIPOS web UI
  -> native bridge adapter for offline capability checks

Android Native Offline Engine
  -> SQLite/Room local database
  -> local order/payment queue
  -> sync queue with retry and idempotency
  -> tenant/branch partitioned storage

CpIPOS Server
  -> validates uploaded offline records
  -> enforces tenant/branch/user/device/shift rules
  -> rejects duplicates using idempotency keys
  -> stores final authoritative records
```

Offline mode should be limited at first. It should not attempt to replicate full backoffice behavior locally.

## Data Flow

### Online Normal Mode

```text
Web UI
-> existing CpIPOS APIs
-> server validates session/scope
-> server creates orders/payments
-> print adapter handles printing separately
```

### Future Offline Order Creation

```text
Network unavailable
-> APK shows offline banner
-> offline mode enabled only when server-issued offline permission exists and local context is fresh enough
-> local order is created with local_id and idempotency_key
-> local payment record is created only under approved offline rules
-> receipt can print locally if native printer bridge exists
-> record enters sync_queue
```

### Sync When Network Returns

```text
Network returns
-> sync engine reads sync_queue
-> sends records to server with idempotency_key
-> server validates tenant, branch, device, user, role, shift/offline policy
-> server creates/merges authoritative records
-> duplicate idempotency_key returns existing result
-> local record marked synced or failed_needs_review
```

## Required Local Data Concepts

Future local tables should include at minimum:

```text
local_orders
local_order_items
local_payments
sync_queue
local_print_logs
local_device_context
```

Every offline-created business record must include:

```text
local_id
idempotency_key
tenant_id_hint
branch_id_hint
device_id_hint
created_by_user_id_hint
created_at_local
created_at_device_clock
sync_status
```

The `_hint` fields are not authoritative. The server must validate them against a trusted session/device/offline grant.

## Security Rules

- Offline mode must not expose Supabase service role key or admin secrets in APK.
- Offline mode must not trust local tenant, branch, user, role, permission, or device data as authoritative.
- Offline records must be tenant/branch partitioned locally.
- Offline sync must use idempotency keys to prevent duplicate orders/payments.
- Offline payment support must be limited and explicitly approved by policy.
- Offline mode must not allow cross-tenant sync.
- Offline data must be encrypted at rest where feasible for production devices.
- Offline mode must expire or require revalidation after a configured window.
- Server must reject offline sync if device, tenant, branch, user, or package state is no longer valid.
- Printing success/failure remains separate from payment truth.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Duplicate orders after reconnect | Revenue/order corruption | Idempotency keys and server duplicate handling |
| Offline sales under wrong tenant/branch | Cross-tenant data breach | Partition local data and revalidate server-side |
| Device clock drift | Wrong business day/shift | Store local and server timestamps; reconcile server-side |
| Shift changed while offline | Shift reports mismatch | Server-side offline shift policy and reconciliation |
| Local payment accepted incorrectly | Financial discrepancy | Restrict offline payment types and sync review states |
| Inventory goes negative after sync | Stock inaccuracies | Treat offline stock deduction as reconciled server-side event |
| APK lost/stolen with data | Data exposure | Encrypt local database and support device revocation |

## Implementation Phases

### Phase 0: Documentation And Guardrails

- Document offline-first plan only.
- Do not implement offline database or sync engine.
- Keep Android APK online-first.

### Phase 1: Offline Awareness Only

- Add network status display.
- Add offline banner.
- Disable actions that require online validation.
- Do not create offline orders yet.

### Phase 2: Read-Only Offline Cache

- Cache safe reference data such as selected product catalog snapshots.
- Mark cache as non-authoritative.
- Do not create payments/orders offline yet.

### Phase 3: Limited Offline Order Drafts

- Allow local draft carts/orders only.
- Require online sync before payment completion.
- Use local_id/idempotency_key for drafts.

### Phase 4: Controlled Offline Sales

- Enable only for tenants/packages/devices with explicit offline policy.
- Support limited payment types.
- Sync with idempotency and conflict review.

### Phase 5: Full Offline Sync Engine

- Add robust sync queue and retry states.
- Add admin review for failed/conflicted records.
- Add offline print logs and reconciliation reports.

## Acceptance Checklist

- [ ] Offline mode is documented as a future phase, not implemented now.
- [ ] Online CpIPOS APIs remain authoritative.
- [ ] Offline records require local_id and idempotency_key.
- [ ] Server prevents duplicate orders/payments during sync.
- [ ] Tenant and branch boundaries are preserved during offline storage and sync.
- [ ] Offline mode does not expose service-role or admin secrets.
- [ ] Offline payment support is explicitly gated and policy-controlled.
- [ ] Printing/cash drawer success does not block or define payment truth.
- [ ] Existing web POS behavior remains unchanged during documentation phase.
