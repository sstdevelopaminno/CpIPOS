# CpIPOS Windows Runtime IT API Contract 2026-08-02

## Purpose

This document defines the API boundary between CpIPOS Windows, CpIPOS Web, future CpIPOS app runtimes, and IT Backoffice for license/package-controlled offline mode.

## Universal Identity Anchor

`store_code` is the required identity anchor for all customer-facing CpIPOS runtimes.

This rule applies to:

- CpIPOS Web
- CpIPOS Windows
- future CpIPOS Android/iOS app runtime

Rules:

1. The runtime must start from the store code created by IT Backoffice.
2. The first activation must be online so IT Backoffice can unlock the package attached to that store code.
3. The runtime must not trust client-supplied `tenant_id`, `branch_id`, package, license, or device context until the server resolves it from `store_code`.
4. `tenant_id`, `branch_id`, package, license, and device binding are server-resolved context, not customer-entered identity.
5. If `store_code` is missing, CpIPOS Windows must stay in `store_code_required` / `not_activated` mode.
6. If IT Backoffice has not unlocked CpIPOS Windows for that store code, CpIPOS Windows must stay locked even after installation.
7. A customer moving from CpIPOS Web to CpIPOS Windows keeps the same store code.
8. Future app runtimes must follow the same store-code-first flow.

There is no customer-side or Windows-side full-access bypass. Feature access is controlled by IT Backoffice package entitlement only.

## Current Test Store Unlock

For the current sales demo and development flow, IT Backoffice policy unlocks this store code as full package:

```text
NDL-TH-001
```

Current foundation behavior:

- `NDL-TH-001` receives `CPIPOS_FULL_TEST`.
- All current feature flags are enabled for sales demo and development.
- The unlock is tied to the store code, not to an environment flag or command-line bypass.
- Cloud sync entitlement is allowed by package, but live order/payment sync write endpoints are still a later implementation step.

## API Boundary

Customer runtime routes:

- `GET|POST /api/windows-runtime/v1/bootstrap`
- `GET|POST /api/windows-runtime/v1/entitlements`
- `GET /api/windows-runtime/v1/sync/status`

Future sync routes:

- `POST /api/windows-runtime/v1/sync/orders`
- `POST /api/windows-runtime/v1/sync/payments`
- `POST /api/windows-runtime/v1/sync/print-jobs`
- `GET /api/windows-runtime/v1/sync/pull-catalog`

IT Admin routes remain under:

- `/api/it-admin/v1/*`
- `/api/it-admin/admin/*`

## Bootstrap API

### `GET /api/windows-runtime/v1/bootstrap`

Returns the default runtime contract. Without a store code, the response stays locked as `store_code_required`.

### `POST /api/windows-runtime/v1/bootstrap`

Request body:

```json
{
  "store_code": "NDL-TH-001",
  "runtime_device_id": "local-device-uuid",
  "device_code": "POS-COUNTER-01",
  "app_version": "0.1.3",
  "bridge_version": "cpipos-windows-native-bridge-0.1.3"
}
```

Do not send trusted tenant context from the runtime. These are optional diagnostics only until server resolution is fully wired to IT Backoffice data:

```json
{
  "tenant_id": "optional-known-tenant",
  "branch_id": "optional-known-branch"
}
```

Response shape is the standard `ok({ data })` wrapper.

Payload fields:

- `contract_version`
- `identity_anchor=store_code`
- `mode=store_code_required|store_code_locked|offline_purchase|cloud_package`
- `runtime`
- `store`
- `activation`
- `license`
- `entitlements.features`
- `entitlements.limits`
- `local_database`
- `sync`
- `warnings`

## Entitlements API

### `GET|POST /api/windows-runtime/v1/entitlements`

Returns license and feature matrix only. This is a lighter endpoint for refreshing cached feature flags.

## Sync Status API

### `GET /api/windows-runtime/v1/sync/status`

Returns the current sync phase. As of this foundation phase:

```json
{
  "sync": {
    "phase": "offline_database_foundation",
    "live_order_sync": "not_enabled_yet"
  }
}
```

## Security Rules

- No Supabase service role key in Windows runtime.
- No admin secrets in Windows runtime.
- Store code is required before package unlock.
- Runtime-side feature flags are not trusted; server entitlement is the source of truth.
- Do not trust local tenant/branch/device/package without server validation.
- Every future order/payment sync must carry an idempotency key.
- Every cloud sync request must validate package entitlement server-side.
- Offline-purchase licenses must not call cloud sync endpoints successfully.
- Cloud package expiry must lock cloud features after reconnect.

## Current Implementation Status

Implemented now:

- Store-code-first bootstrap contract route.
- Store-code-first entitlements contract route.
- Sync status contract route.
- `NDL-TH-001` full-package policy for sales demo and development.
- Windows runtime `--store-code=...` local option.
- Local SQLite schema file for offline foundation.

Not implemented yet:

- Actual SQLite runtime data access from C#.
- Web UI offline order write path.
- Sync orders/payments to server.
- IT Admin UI for Windows license management.
- Production database-backed package entitlement lookup for this Windows runtime layer.

## Next Implementation Step

Implement the local SQLite runtime in CpIPOS Windows:

1. Add SQLite package to Windows project.
2. Create database at `%LOCALAPPDATA%\\CpIPOS\\WindowsRuntime\\data\\cpipos-local.db`.
3. Run `cpipos-local-schema-v0.1.0.sql` on first launch.
4. Call bootstrap API on launch when online.
5. Cache store context, license, and entitlements.
6. Expose a native WebView bridge so the web UI can read local entitlements and offline status.
