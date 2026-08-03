# Windows Runtime Safety + Offline Foundation 2026-08-03

## Scope

This patch continues the Windows Runtime work in four safety-first groups:

1. Windows Runtime Safety Patch
2. Printer 58/80 mm foundation
3. Server-backed Windows activation guardrails
4. Offline engine database foundation

The patch intentionally does **not** enable live offline order/payment sync yet. Live sync remains disabled until signed activation, idempotency handling, conflict resolution, and server package validation are implemented and tested end to end.

## Version

- Windows Runtime package: `0.1.5`
- Native bridge: `cpipos-windows-native-bridge-0.1.5`
- Local SQLite schema: `0.1.0`

The Windows build workflow now checks version consistency across:

- `Cpipos.WindowsRuntime.csproj`
- `MainForm.cs`
- `LocalPrintBridge.cs`
- `CpIPOSWindowsRuntime.iss`

## 1. Windows Runtime Safety Patch

### Startup and URL policy

`Program.cs` now restricts the production runtime URL to:

```text
https://cp-ipos-web.vercel.app
```

Custom URLs are allowed only for local development when explicitly enabled with:

```powershell
Cpipos.WindowsRuntime.exe --url=http://localhost:3000/login/store --allow-custom-url
```

or:

```powershell
$env:CPIPOS_ALLOW_CUSTOM_APP_URL="1"
```

This prevents the Windows runtime from accidentally injecting the local bridge into arbitrary websites.

### Bridge startup resilience

If `127.0.0.1:3210` is already in use, the app shows a warning and still opens the WebView. Sales UI can still load, but Local Bridge printing is unavailable until the port conflict is fixed.

### Bridge token

The runtime generates a random 32-byte bridge token on each app launch and injects it into the WebView session:

```js
window.CpIPOSWindowsRuntime.bridge_token
sessionStorage.getItem("cpi_local_bridge_token_v1")
```

Bridge write/control endpoints require:

```http
X-CpIPOS-Bridge-Token: <token>
```

Protected endpoints:

- `GET /printers`
- `POST /print/test`
- `POST /print`
- `POST /api/print`

Read-only health endpoints remain public for local diagnostics:

- `GET /health`
- `GET /print/status`
- `GET /capabilities`

### CORS policy

The bridge no longer returns `Access-Control-Allow-Origin: *`.

Allowed browser origins:

- `https://cp-ipos-web.vercel.app`
- `http://localhost:3000`
- `http://127.0.0.1:3000`

The local development origins still require the bridge token for protected endpoints.

### Request stability

The bridge now adds:

- request concurrency limit
- request timeout
- payload/header size checks
- idempotent `Dispose()`
- serialized print lock retained
- bridge busy response instead of unbounded task growth

## 2. Printer 58/80 mm foundation

This patch does not replace the full receipt renderer yet, but it improves the bridge foundation:

- keeps serialized print queue behavior
- exposes token-required capabilities
- carries `paper_width_mm` in local offline print jobs
- prevents single-page text truncation by allowing multi-page `PrintDocument` output for long text payloads

Future printer work should still create a canonical receipt renderer shared by preview and auto print jobs, then map output to ESC/POS raster or text commands per printer profile.

## 3. Server-backed activation guardrails

The previous demo policy hard-coded `NDL-TH-001` as full-access. This is now locked behind an explicit server flag:

```env
WINDOWS_RUNTIME_ENABLE_DEMO_STORE_CODE=true
```

Default is locked:

```env
WINDOWS_RUNTIME_ENABLE_DEMO_STORE_CODE=false
```

Important production rule:

Do not use the demo flag for customer activation. Production Windows activation must resolve tenant/package/device policy from IT Backoffice/Supabase and must not trust client-supplied `tenant_id` or `branch_id`.

The entitlement contract now intentionally ignores client-supplied tenant and branch identifiers. Branch remains `null` until a trusted server-side activation path resolves it.

Windows runtime APIs now have rate limiting and invalid JSON responses:

- `/api/windows-runtime/v1/bootstrap`
- `/api/windows-runtime/v1/entitlements`
- `/api/windows-runtime/v1/sync/status`

Environment knobs:

```env
WINDOWS_RUNTIME_RATE_LIMIT_MAX=60
WINDOWS_RUNTIME_ENABLE_DEMO_STORE_CODE=false
```

## 4. Offline engine database foundation

The local SQLite schema now stores accounting money as integer satang instead of floating-point REAL values.

Examples:

```text
125.50 THB -> 12550
1.00 THB   -> 100
```

Updated schema areas:

- `local_products.price_satang`
- `local_orders.subtotal_satang`
- `local_orders.discount_total_satang`
- `local_orders.tax_total_satang`
- `local_orders.total_satang`
- `local_order_items.unit_price_satang`
- `local_order_items.line_total_satang`
- `local_payments.amount_satang`
- `local_shifts.opening_cash_satang`
- `local_shifts.closing_cash_satang`

Additional foundation tables:

- `local_activation_leases`
- `local_catalog_snapshots`
- `sync_conflicts`

Quantity uses `qty_milli` so fractional quantities can be represented without floating point.

## Live sync status

`GET /api/windows-runtime/v1/sync/status` now explicitly reports:

```text
live_order_sync: not_enabled_yet
live_payment_sync: not_enabled_yet
live_catalog_pull: not_enabled_yet
```

The status response documents the reason: live sync must wait for signed activation, idempotency, conflict handling, and server package validation.

## Required verification commands

### Web baseline

```powershell
cd E:\CpIPOS
corepack pnpm install --frozen-lockfile
corepack pnpm --filter backoffice-web typecheck
corepack pnpm --filter backoffice-web exec vitest run --cache false
corepack pnpm --filter backoffice-web exec eslint src scripts tests next.config.ts eslint.config.mjs --cache --cache-location ..\..\.tmp-eslintcache --no-error-on-unmatched-pattern
corepack pnpm schema:drift
corepack pnpm --filter backoffice-web build
```

### Windows build baseline

```powershell
cd E:\CpIPOS
& "C:\Program Files\dotnet\dotnet.exe" restore .\apps\windows-runtime-native\Cpipos.WindowsRuntime\Cpipos.WindowsRuntime.csproj
& "C:\Program Files\dotnet\dotnet.exe" publish .\apps\windows-runtime-native\Cpipos.WindowsRuntime\Cpipos.WindowsRuntime.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:EnableCompressionInSingleFile=true `
  -o .\artifacts\CpIPOS-WindowsRuntime-win-x64
```

### Windows bridge smoke test

Launch CpIPOS Windows Runtime, then run:

```powershell
Invoke-RestMethod http://127.0.0.1:3210/health
Invoke-RestMethod http://127.0.0.1:3210/capabilities
```

Protected endpoints must fail without token:

```powershell
Invoke-RestMethod http://127.0.0.1:3210/printers
```

From WebView context, use the runtime-injected token for protected endpoints:

```js
fetch("http://127.0.0.1:3210/printers", {
  headers: {
    "X-CpIPOS-Bridge-Token": sessionStorage.getItem("cpi_local_bridge_token_v1")
  }
})
```

### Entitlement smoke test

Locked by default:

```powershell
$body = @{
  store_code = "NDL-TH-001"
  runtime_device_id = "test-windows-device-001"
  device_code = "POS-COUNTER-01"
  app_version = "0.1.5"
  bridge_version = "cpipos-windows-native-bridge-0.1.5"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://cp-ipos-web.vercel.app/api/windows-runtime/v1/bootstrap" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

For controlled demo/sales only, set this in Vercel or local env:

```env
WINDOWS_RUNTIME_ENABLE_DEMO_STORE_CODE=true
```

## Remaining production work

The following are intentionally not enabled in this patch:

1. Supabase-backed activation lease issuance
2. Runtime device registration and revocation
3. Offline catalog pull endpoint
4. Offline order/payment write endpoints
5. Sync conflict resolution workflow
6. Code-signed Windows installer
7. Canonical ESC/POS receipt renderer shared by preview and queue

These are the next production hardening steps after this safety foundation passes local Windows and Web CI checks.
