# CpIPOS Windows Runtime MVP 2026-08-02

## Purpose

This document defines the first usable Windows runtime path for CpIPOS while Android APK work waits for a later implementation phase.

The immediate goal is to let a Windows cashier machine run CpIPOS like a desktop POS program and start the local print bridge automatically, without waiting for Codex or rebuilding the existing web UI.

## What This MVP Provides

- A Windows launcher under `tools/windows-runtime`.
- Opens the existing CpIPOS production web UI in Microsoft Edge or Chrome app mode.
- No visible browser address bar in normal app mode.
- Starts the local Windows print bridge before launching the app.
- Reuses the existing CpIPOS login flow: `/login/store -> branch/employee -> device -> /preview/pos`.
- Keeps the existing web UI as the source of truth.
- Does not change `backoffice-web`, POS APIs, Supabase logic, payment flow, shift flow, table QR, or tenant isolation rules.

## Files

```text
tools/windows-runtime/CpIPOS-Windows-Runtime.bat
tools/windows-runtime/start-cpipos-windows-runtime.ps1
tools/windows-runtime/runtime-config.example.json
tools/windows-runtime/offline.html
```

## Current CpIPOS Behavior To Preserve

- Web POS remains the main UI.
- Server validates tenant, branch, role, device, and POS session.
- Client-provided `tenant_id`, `branch_id`, `device_code`, or local state is never trusted without server validation.
- Payment completion must not be blocked by print success.
- Printing must use the Print Adapter Architecture, with Web Serial disabled as the default.
- Small-shop Windows default adapter is `LOCAL_BRIDGE_WINDOWS`.

## Architecture

```text
Windows cashier machine
  -> CpIPOS-Windows-Runtime.bat
  -> start-cpipos-windows-runtime.ps1
  -> Local Print Bridge on 127.0.0.1:3210
  -> Microsoft Edge/Chrome app mode
  -> https://cp-ipos-web.vercel.app/login/store
  -> Existing CpIPOS web POS UI
```

The launcher does not create a new native UI. It simply provides a Windows runtime container around the existing web UI and starts the local print bridge in the same workstation environment.

## Data Flow

### Online sales flow

```text
Cashier opens Windows Runtime
  -> Runtime starts Local Print Bridge
  -> Runtime opens CpIPOS web UI
  -> User logs in with current store/branch/employee/device flow
  -> POS APIs run against Supabase through the existing backend
  -> Print jobs use local bridge / Windows printer adapter where configured
```

### Print flow

```text
CpIPOS web UI
  -> Bridge URL http://127.0.0.1:3210/print
  -> Local Print Bridge
  -> Windows Printer Driver
  -> Thermal printer
```

## Offline Behavior In This MVP

This MVP is not the final offline sales engine.

It can:

- Start the local print bridge without internet.
- Open an offline fallback page when the production URL cannot be reached.
- Keep a separate browser profile for CpIPOS runtime cache/session isolation.

It does not yet:

- Create local offline orders.
- Accept offline payments as durable POS records.
- Sync offline orders back to Cloud.
- Maintain an offline shift ledger.
- Guarantee safe offline tenant/branch/user permission replay.

Full offline sales requires a future `Windows Offline Sales Engine` with local database, idempotency keys, local receipt sequence rules, and a safe sync queue.

## Security Rules

- Do not store Supabase service-role keys in the Windows runtime.
- Do not store admin secrets in the runtime config.
- Do not let the launcher assign tenant or branch identity.
- Keep all tenant/branch/device validation server-side.
- Use local runtime cache only for app shell/session convenience, not authorization truth.
- Offline sales must not be enabled until idempotency and sync conflict rules are implemented.

## Usage

Pull latest source first:

```powershell
$env:Path="C:\Program Files\nodejs;C:\Program Files\Git\cmd;$env:Path"
cd E:\CpIPOS
git fetch origin
git checkout agent-docs-preflight-schema-drift
git pull --ff-only origin agent-docs-preflight-schema-drift
```

Start the Windows Runtime:

```powershell
cd E:\CpIPOS\tools\windows-runtime
.\CpIPOS-Windows-Runtime.bat
```

Or run PowerShell directly:

```powershell
cd E:\CpIPOS\tools\windows-runtime
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-cpipos-windows-runtime.ps1
```

Run with a specific Windows printer:

```powershell
cd E:\CpIPOS\tools\windows-runtime
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-cpipos-windows-runtime.ps1 -WindowsPrinter "MTP-II"
```

Use Chrome instead of Edge:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-cpipos-windows-runtime.ps1 -UseChrome
```

Open without fullscreen during debugging:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-cpipos-windows-runtime.ps1 -NoFullscreen
```

Skip local bridge during debugging:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-cpipos-windows-runtime.ps1 -SkipBridge
```

## Configuration

Copy:

```text
tools/windows-runtime/runtime-config.example.json
```

to:

```text
tools/windows-runtime/runtime-config.json
```

Then customize values such as:

```json
{
  "app_url": "https://cp-ipos-web.vercel.app/login/store",
  "bridge_url": "http://127.0.0.1:3210/print",
  "bridge_health_url": "http://127.0.0.1:3210/health",
  "windows_printer": "MTP-II",
  "fullscreen": true,
  "browser": "edge"
}
```

Do not commit machine-specific `runtime-config.json` if it contains local printer names or machine-specific settings.

## Risks

- Edge/Chrome app mode is not a fully packaged `.exe` installer yet.
- Offline fallback page is not offline POS sales.
- Browser cache behavior may still depend on the current web app service worker/no-cache rules.
- Local bridge requires Node.js on the Windows machine for this MVP.
- Windows printer drivers must be installed and working before CpIPOS can print reliably.

## Implementation Phases

### Phase 1: MVP Runtime Launcher

- Add Windows launcher scripts.
- Start local print bridge.
- Open existing web POS in Edge/Chrome app mode.
- Keep Web Serial out of the default print path.

### Phase 2: Packaged Windows Runtime

- Convert launcher to an installer or Electron/Tauri/WebView2 shell if needed.
- Bundle bridge logic so users do not manually open Node scripts.
- Add automatic startup option for cashier machines.
- Add version display and bridge status page.

### Phase 3: Offline Sales Engine

- Add local database.
- Add local order/payment/print queues.
- Add idempotency keys.
- Add sync status and conflict handling.
- Add server-side duplicate prevention.
- Add offline-safe device/session lease rules.

## Acceptance Checklist

- [ ] `CpIPOS-Windows-Runtime.bat` opens without PowerShell policy failure.
- [ ] Local Print Bridge starts automatically or is already detected.
- [ ] `http://127.0.0.1:3210/health` returns online status.
- [ ] Edge/Chrome opens CpIPOS without browser address bar.
- [ ] Login flow still starts at `/login/store`.
- [ ] POS session and device selection still use server validation.
- [ ] Web Serial does not open as the default printer path.
- [ ] Test print uses Local Bridge.
- [ ] Existing web app behavior is not changed.
- [ ] No Supabase service-role key or admin secret is stored in runtime files.
