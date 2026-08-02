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
2. The runtime must not trust client-supplied `tenant_id`, `branch_id`, or `device_code` until the server resolves them from `store_code`.
3. `tenant_id`, `branch_id`, package, license, and device binding are server-resolved context, not customer-entered identity.
4. If `store_code` is missing, CpIPOS Windows must stay in `store_code_required` / `not_activated` mode.
5. A customer moving from CpIPOS Web to CpIPOS Windows keeps the same store code.
6. Future app runtimes must follow the same store-code-first flow.

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

Returns the default runtime contract. Without a store code, the response must stay locked as `store_code_required`.

### `POST /api/windows-runtime/v1/bootstrap`

Request body:

```json
{
  "store_code": "NDL-TH-001",
  "runtime_device_id": "local-device-uuid",
  "device_code": "POS-COUNTER-01",
  "app_version": "0.1.3",
  "bridge_version": "cpipos-windows-native-bridge-0.1.3",
  "dev_full_access": true
}
```

Do not send trusted tenant context from the runtime. These are optional diagnostics only until server resolution is implemented:

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
- `mode=store_code_required|offline_only|cloud_package|test_full_access`
- `runtime.store_code`
- `license`
- `entitlements.features`
- `entitlements.limits`
- `local_database`
- `sync`
- `warnings`

Missing store code response:

```json
{
  "identity_anchor": "store_code",
  "mode": "store_code_required",
  "license": {
    "status": "not_activated",
    "license_type": "store_code_required",
    "package_code": "STORE_CODE_REQUIRED",
    "cloud_sync_allowed": false
  },
  "sync": {
    "status": "disabled_store_code_required",
    "order_sync_ready": false
  }
}
```

## Entitlements API

### `GET|POST /api/windows-runtime/v1/entitlements`

Returns license and feature matrix only. This is a lighter endpoint for refreshing cached feature flags.

Request body should include the same `store_code` anchor:

```json
{
  "store_code": "NDL-TH-001",
  "runtime_device_id": "local-device-uuid",
  "device_code": "POS-COUNTER-01",
  "dev_full_access": true
}
```

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
Cpipos.WindowsRuntime.exe --store-code=NDL-TH-001 --dev-full-access
```

The server still controls whether full access is honored:

```text
CPIPOS_WINDOWS_DEV_FULL_ACCESS=1
```

When server env is not enabled, `dev_full_access=true` is ignored and the runtime receives offline-only features. Full-access testing still requires a store code so the test machine follows the same identity model as customers.

## Security Rules

- No Supabase service role key in Windows runtime.
- No admin secrets in Windows runtime.
- `store_code` is the only customer-entered store identity.
- Do not trust local tenant/branch/device/package without server validation.
- Server must resolve tenant/branch/device/package from store code and authenticated context.
- Every future order/payment sync must carry an idempotency key.
- Every cloud sync request must validate package entitlement server-side.
- Offline-only license must not call cloud sync endpoints successfully.
- Cloud package expiry must lock cloud features after reconnect.

## Current Implementation Status

Implemented now:

- Bootstrap contract route.
- Entitlements contract route.
- Sync status contract route.
- Windows runtime `--store-code=` option.
- Windows runtime `--dev-full-access` local flag.
- Store-code-required response mode.
- Local SQLite schema file with `store_code` as local identity anchor.

Not implemented yet:

- Actual SQLite runtime data access from C#.
- Server DB lookup that resolves store code to tenant/branch/device/package for this Windows endpoint.
- Web UI offline order write path.
- Sync orders/payments to server.
- IT Admin UI for Windows licenses.
- Production package tables and migration for this specific Windows entitlement layer.

## Next Implementation Step

Implement the local SQLite runtime in CpIPOS Windows:

1. Add SQLite package to Windows project.
2. Create database at `%LOCALAPPDATA%\\CpIPOS\\WindowsRuntime\\data\\cpipos-local.db`.
3. Run `cpipos-local-schema-v0.1.0.sql` on first launch.
4. Call bootstrap API on launch when online with `store_code`.
5. Cache `local_store_context`, `local_license`, and `local_entitlements`.
6. Expose a native WebView bridge so the web UI can read local entitlements and offline status.
7. Add IT Backoffice routes to issue/disable Windows runtime licenses by store code.
