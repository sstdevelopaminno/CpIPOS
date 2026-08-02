# Codex Handoff: CpIPOS Web + CpIPOS Windows Runtime 2026-08-02

## Purpose

This handoff tells Codex that CpIPOS now has two active runtime surfaces that must be treated separately but tested together:

1. **CpIPOS Web**
   - Main online web app.
   - POS UI, login flow, tenant/branch/user/device/session/shift/sales/table QR/backoffice.
   - Deployed by Vercel from GitHub.

2. **CpIPOS Windows Runtime**
   - Installable Windows runtime for POS terminals.
   - WebView2 shell loading CpIPOS Web.
   - Native local print bridge on `127.0.0.1:3210`.
   - Store-code anchored package entitlement contract.
   - Local SQLite offline schema foundation.
   - Installer/package/title bar/shortcut icon must use bundled `assets/cpipos.ico`.

Do not treat CpIPOS Windows as just a browser shortcut. It is a Windows runtime package with its own C# project, installer, workflow, local bridge, and future offline database path.

## Current Source Of Truth

- Repo: `sstdevelopaminno/CpIPOS`
- Branch: `agent-docs-preflight-schema-drift`
- Web app: `apps/backoffice-web`
- Windows runtime: `apps/windows-runtime-native/Cpipos.WindowsRuntime`
- Windows installer: `apps/windows-runtime-native/installer/CpIPOSWindowsRuntime.iss`
- Windows build workflow: `.github/workflows/build-windows-runtime.yml`
- Active Windows version: `0.1.4`
- Windows icon source: `apps/windows-runtime-native/Cpipos.WindowsRuntime/assets/cpipos.ico.b64`
- Restored build icon: `apps/windows-runtime-native/Cpipos.WindowsRuntime/assets/cpipos.ico`

## Product Boundary

### CpIPOS Web

CpIPOS Web is responsible for:

- Store-code login.
- Branch/device/employee/session/shift flow.
- POS sales UI and online transaction APIs.
- Table QR ordering.
- Backoffice and IT Admin package controls.
- Server-side tenant/package/feature validation.

### CpIPOS Windows Runtime

CpIPOS Windows is responsible for:

- Opening CpIPOS as a normal Windows program window.
- Hiding browser address bar and browser UI.
- Local Windows printer bridge.
- Future local SQLite offline database.
- Future sync queue and cloud sync, gated by package entitlement.
- Desktop/start-menu shortcut and title bar icon.

## Store Code Rule

`store_code` is the required identity anchor across all CpIPOS runtimes:

- CpIPOS Web
- CpIPOS Windows
- Future CpIPOS Android/iOS app runtime

Do not allow Windows or any client runtime to unlock features by local flag or environment variable. Runtime features must be unlocked by server-side IT Backoffice/package entitlement policy resolved from `store_code`.

Current development/sales test store:

```text
NDL-TH-001
```

Expected contract for `NDL-TH-001` in Windows entitlement foundation:

- `mode = cloud_package`
- `package_code = CPIPOS_FULL_TEST`
- `cloud_sync_allowed = true`
- feature flags enabled for sales demo/development

Other store codes must remain locked until IT Backoffice package logic unlocks them.

## Recent Windows Icon Fix Context

The user reported that the installed Windows shortcut, taskbar, and title bar still showed the default WinForms/Windows icon even though the web app logo was correct. The issue is now treated as a Windows package/installer/title-bar problem, not a web app problem.

Current expected icon behavior:

1. `cpipos.ico.b64` is decoded into `assets/cpipos.ico` during GitHub Actions.
2. `.csproj` uses `<ApplicationIcon>assets\cpipos.ico</ApplicationIcon>`.
3. `.csproj` copies `assets\cpipos.ico` to output/publish.
4. Workflow bundles icon to:
   - `artifacts/CpIPOS-WindowsRuntime-win-x64/assets/cpipos.ico`
   - `artifacts/CpIPOS-WindowsRuntime-win-x64/cpipos.ico`
5. Installer additionally installs icon to:
   - `{app}\assets\cpipos.ico`
   - `{app}\cpipos.ico`
6. Desktop and Start Menu shortcuts use:
   - `IconFilename: {app}\assets\cpipos.ico`
7. `MainForm` loads title bar icon from installed file first, then falls back to associated EXE icon.
8. Workflow validates package icon presence before release upload.

Important: do not reintroduce web favicon download as the Windows icon source. The user supplied the intended Windows icon file.

## Files To Inspect First For Current Windows Issues

- `apps/windows-runtime-native/Cpipos.WindowsRuntime/Cpipos.WindowsRuntime.csproj`
- `apps/windows-runtime-native/Cpipos.WindowsRuntime/MainForm.cs`
- `apps/windows-runtime-native/Cpipos.WindowsRuntime/Program.cs`
- `apps/windows-runtime-native/Cpipos.WindowsRuntime/LocalPrintBridge.cs`
- `apps/windows-runtime-native/Cpipos.WindowsRuntime/Offline/cpipos-local-schema-v0.1.0.sql`
- `apps/windows-runtime-native/installer/CpIPOSWindowsRuntime.iss`
- `.github/workflows/build-windows-runtime.yml`
- `apps/backoffice-web/src/lib/windows-runtime/entitlements.ts`
- `apps/backoffice-web/src/app/api/windows-runtime/v1/bootstrap/route.ts`
- `apps/backoffice-web/src/app/api/windows-runtime/v1/entitlements/route.ts`
- `apps/backoffice-web/src/app/api/windows-runtime/v1/sync/status/route.ts`

## Required Audit Scope For Codex

When asked to inspect bugs, slowness, disconnects, bottlenecks, or stability problems, Codex must check both runtimes.

### Web audit scope

Check:

- Login/store-code route and API latency.
- Branch/device/session/shift flow.
- POS preview/sales APIs.
- Table QR order submit path.
- Server route timeouts and unbounded Supabase selects.
- Suspense/loading states and buttons stuck in disabled/loading state.
- Repeated API calls or client polling loops.
- Missing pagination or aggregate queries.
- Vercel build/runtime errors.

### Windows audit scope

Check:

- WebView2 startup and navigation failure handling.
- Title bar/shortcut/taskbar icon packaging.
- Installer file inclusion and shortcut recreation.
- Windows icon cache false positives after reinstall.
- Local print bridge health/printers/status endpoints.
- Serialized print queue behavior.
- Printer name resolution and fallback to Windows default printer.
- CORS and JSON response consistency from `127.0.0.1:3210`.
- App version consistency across csproj/MainForm/LocalPrintBridge/workflow/installer.
- GitHub Actions Windows build logs and artifacts.
- Release upload replacing old installer assets.

## Current Known Build/Release Process

Windows installer does not auto-build on every commit. It is intentionally manual-only to prevent Windows packaging failures from making every web commit red.

Manual release path:

```text
GitHub -> Actions -> Build CpIPOS Windows Runtime -> Run workflow
```

After workflow passes, the latest installer should be available from:

```text
https://cp-ipos-web.vercel.app/download/windows-runtime
```

## Local Windows Test Procedure

1. Pull latest source.
2. Build or download Windows Runtime `0.1.4`.
3. Uninstall old CpIPOS / CpIPOS Windows Runtime.
4. Delete old shortcuts.
5. Clear Windows icon cache.
6. Install new `CpIPOS-WindowsRuntime-Setup.exe`.
7. Confirm installed files exist:
   - `%LOCALAPPDATA%\Programs\CpIPOS\assets\cpipos.ico`
   - `%LOCALAPPDATA%\Programs\CpIPOS\cpipos.ico`
   - `%LOCALAPPDATA%\Programs\CpIPOS\Cpipos.WindowsRuntime.exe`
8. Confirm Desktop shortcut uses `assets\cpipos.ico`.
9. Launch app and confirm title bar icon is not the default WinForms icon.
10. Test bridge endpoints:
    - `http://127.0.0.1:3210/health`
    - `http://127.0.0.1:3210/printers`
    - `http://127.0.0.1:3210/print/status`

## Local Pull Commands

```powershell
$env:Path="C:\Program Files\nodejs;C:\Program Files\Git\cmd;$env:Path"
cd E:\CpIPOS
git status -sb
git fetch origin
git checkout agent-docs-preflight-schema-drift
git pull --ff-only origin agent-docs-preflight-schema-drift
git log -1 --oneline
```

If local files are modified and the user wants to discard local edits after confirming they are not needed:

```powershell
cd E:\CpIPOS
git status -sb
git reset --hard origin/agent-docs-preflight-schema-drift
git clean -fd
```

## Verification Commands

Web app baseline:

```powershell
cd E:\CpIPOS
corepack pnpm --filter backoffice-web typecheck
corepack pnpm --filter backoffice-web exec vitest run --cache false
corepack pnpm --filter backoffice-web exec eslint src scripts tests next.config.ts eslint.config.mjs --cache --cache-location ..\..\.tmp-eslintcache --no-error-on-unmatched-pattern
corepack pnpm --filter backoffice-web build
```

Windows runtime local build baseline:

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

Icon/package verification:

```powershell
Test-Path .\artifacts\CpIPOS-WindowsRuntime-win-x64\assets\cpipos.ico
Test-Path .\artifacts\CpIPOS-WindowsRuntime-win-x64\cpipos.ico
Test-Path .\artifacts\CpIPOS-WindowsRuntime-win-x64\Cpipos.WindowsRuntime.exe
```

Bridge smoke test after launching CpIPOS Windows:

```powershell
Invoke-RestMethod http://127.0.0.1:3210/health
Invoke-RestMethod http://127.0.0.1:3210/printers
Invoke-RestMethod http://127.0.0.1:3210/print/status
```

Entitlement smoke test for sales/dev store code:

```powershell
$body = @{
  store_code = "NDL-TH-001"
  runtime_device_id = "test-windows-device-001"
  device_code = "POS-COUNTER-01"
  app_version = "0.1.4"
  bridge_version = "cpipos-windows-native-bridge-0.1.4"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "https://cp-ipos-web.vercel.app/api/windows-runtime/v1/bootstrap" `
  -Method POST `
  -ContentType "application/json" `
  -Body $body
```

## Do Not Do

- Do not use old `E:\SSTiPOS` paths.
- Do not re-enable automatic Windows package build on every push unless explicitly requested.
- Do not make Windows runtime unlock features from local flags/env variables.
- Do not treat tenant_id/branch_id from client as trusted identity.
- Do not fetch favicon from web app for Windows icon packaging.
- Do not remove print bridge serialization.
- Do not enable live offline order/payment sync until idempotency and server package validation are implemented.

## Next Recommended Codex Task

Run a focused audit with this prompt:

```text
Read docs/CODEX-HANDOFF-WEB-AND-WINDOWS-RUNTIME-2026-08-02.md first. Then inspect only the listed Web and Windows Runtime files. Find likely bugs, slowness, disconnects, stuck loading states, printer instability, icon packaging problems, and bottlenecks. Do not do broad refactors. Propose minimal patches first, then apply only safe fixes. Keep CpIPOS Web and CpIPOS Windows responsibilities separate. Update this handoff doc if behavior changes.
```
