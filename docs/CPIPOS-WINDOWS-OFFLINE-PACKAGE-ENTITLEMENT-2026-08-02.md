# CpIPOS Windows Offline + Package Entitlement 2026-08-02

## Purpose

This document defines the target architecture for CpIPOS Windows as an installable Windows runtime with local offline capability, native print bridge, package-controlled licensing, and future cloud sync governed by the IT Backoffice.

## Product Boundary

### CpIPOS Web

CpIPOS Web remains the online source of truth for:

- POS UI updates
- Owner/manager backoffice
- IT Admin backoffice
- cloud package and subscription control
- Supabase/cloud database
- tenant, branch, user, role, device, feature, and contract management

### CpIPOS Windows

CpIPOS Windows is the installable runtime for Windows POS terminals:

- WebView2 shell loading the current CpIPOS Web UI
- native local print bridge on `127.0.0.1:3210`
- local SQLite database for offline phase
- local license and entitlement cache
- future sync engine gated by package entitlements

## Commercial Model

### Offline-only purchase

A customer can buy/install CpIPOS Windows without a cloud package.

Allowed:

- local offline sales
- local cash payment
- local receipt printing
- local shift records
- local report/export in a later phase

Locked:

- cloud sync
- cloud database connection
- cloud dashboard/reporting
- multi-branch cloud aggregation
- package-only functions

### Cloud package subscription

A customer with an active CpIPOS Cloud package can use features according to package entitlements.

Cloud package can enable:

- `cloud_sync_enabled`
- `cloud_backup_enabled`
- `multi_branch_cloud_enabled`
- `advanced_reports_enabled`
- `inventory_enabled`
- `kitchen_display_enabled`
- `table_qr_ordering_enabled`
- `staff_attendance_enabled`
- `online_payment_enabled`
- `ai_feature_enabled`

## Entitlement Rules

1. CpIPOS Windows can be installed on a machine, but features are controlled by license/package.
2. Offline-only customers must not sync to cloud.
3. Cloud sync is allowed only when the server package allows `cloud_sync_enabled`.
4. The server must validate tenant, branch, device, package, and idempotency key on every sync.
5. The local database is not the server source of truth.
6. If the package expires, cloud features must lock when the runtime reconnects.
7. If the machine stays offline beyond policy, local use can be limited by `max_offline_days`.
8. Test machines can be granted `test_full_access` only through explicit dev configuration.

## Test Machine Policy

Internal development machines may run CpIPOS Windows with:

```powershell
Cpipos.WindowsRuntime.exe --dev-full-access
```

The web API only returns true full-access mode when the server environment allows it:

```text
CPIPOS_WINDOWS_DEV_FULL_ACCESS=1
```

This is for development only. Do not enable it for general customer production unless the IT Admin intentionally wants an internal test environment.

## Current API Foundation

Added in this phase:

- `GET|POST /api/windows-runtime/v1/bootstrap`
- `GET|POST /api/windows-runtime/v1/entitlements`
- `GET /api/windows-runtime/v1/sync/status`

Current sync status is contract-ready only. Live order/payment sync is not enabled yet.

## Local Database Foundation

Local SQLite schema file:

```text
apps/windows-runtime-native/Cpipos.WindowsRuntime/Offline/cpipos-local-schema-v0.1.0.sql
```

Key tables:

- `local_license`
- `local_entitlements`
- `local_device_context`
- `local_users_cache`
- `local_categories`
- `local_products`
- `local_shifts`
- `local_orders`
- `local_order_items`
- `local_payments`
- `local_print_jobs`
- `sync_queue`
- `sync_logs`

## Phase Plan

### Phase 1: Contract and schema foundation

- Add Windows entitlement API contract.
- Add local SQLite schema.
- Add Windows runtime dev-full-access flag.
- Keep order/payment sync disabled.

### Phase 2: Local database runtime

- Add SQLite dependency to CpIPOS Windows.
- Create local database on first launch.
- Store license/entitlement bootstrap result locally.
- Store catalog snapshot locally.

### Phase 3: Offline sale MVP

- Allow local cart/order/payment persistence when offline.
- Print receipts through local bridge.
- Record sync queue items.

### Phase 4: Cloud sync for subscribed packages

- Add signed sync endpoints.
- Push local orders/payments with idempotency keys.
- Pull server catalog/package updates.
- Server validates package and tenant/device boundaries.

### Phase 5: IT Backoffice controls

- Add device license management UI.
- Add package entitlement matrix for Windows runtime.
- Add sync queue monitoring.
- Add support actions: suspend device, reset license, export local diagnostics.

## Acceptance Checklist

- CpIPOS Web remains the online source of truth.
- CpIPOS Windows can run as an installable Windows runtime.
- Offline-only package does not receive cloud sync.
- Cloud package can enable sync and higher features.
- Test machine can be full-access only through explicit dev flag and server env.
- Local orders/payments must use idempotency keys before cloud sync is enabled.
- Server must validate all synced tenant/branch/device/package decisions.
