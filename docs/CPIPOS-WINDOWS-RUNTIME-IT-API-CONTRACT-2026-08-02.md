# CpIPOS Windows Runtime IT API Contract 2026-08-02

## Purpose

This document defines the API boundary between CpIPOS Windows, CpIPOS Web, and IT Backoffice for license/package-controlled offline mode.

## API Boundary

Customer Windows runtime routes:

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

Returns default offline-only runtime contract.

### `POST /api/windows-runtime/v1/bootstrap`

Request body:

```json
{
  "runtime_device_id": "local-device-uuid",
  "device_code": "POS-COUNTER-01",
  "tenant_id": "optional-known-tenant",
  "branch_id": "optional-known-branch",
  "app_version": "0.1.3",
  "bridge_version": "cpipos-windows-native-bridge-0.1.3",
  "dev_full_access": true
}
```

Response shape is the standard `ok({ data })` wrapper.

Payload fields:

- `contract_version`
- `mode=offline_only|cloud_package|test_full_access`
- `runtime`
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

## Test Machine Full Access

CpIPOS Windows supports local development flag:

```powershell
Cpipos.WindowsRuntime.exe --dev-full-access
```

The server still controls whether full access is honored:

```text
CPIPOS_WINDOWS_DEV_FULL_ACCESS=1
```

When server env is not enabled, `dev_full_access=true` is ignored and the runtime receives offline-only features.

## Security Rules

- No Supabase service role key in Windows runtime.
- No admin secrets in Windows runtime.
- Do not trust local tenant/branch/device/package without server validation.
- Every future order/payment sync must carry an idempotency key.
- Every cloud sync request must validate package entitlement server-side.
- Offline-only license must not call cloud sync endpoints successfully.
- Cloud package expiry must lock cloud features after reconnect.

## Current Implementation Status

Implemented now:

- Bootstrap contract route.
- Entitlements contract route.
- Sync status contract route.
- Windows runtime `--dev-full-access` local flag.
- Local SQLite schema file for offline foundation.

Not implemented yet:

- Actual SQLite runtime data access from C#.
- Web UI offline order write path.
- Sync orders/payments to server.
- IT Admin UI for Windows licenses.
- Production package tables and migration for this specific Windows entitlement layer.

## Next Implementation Step

Implement the local SQLite runtime in CpIPOS Windows:

1. Add SQLite package to Windows project.
2. Create database at `%LOCALAPPDATA%\CpIPOS\WindowsRuntime\data\cpipos-local.db`.
3. Run `cpipos-local-schema-v0.1.0.sql` on first launch.
4. Call bootstrap API on launch when online.
5. Cache `local_license` and `local_entitlements`.
6. Expose a native WebView bridge so the web UI can read local entitlements and offline status.
