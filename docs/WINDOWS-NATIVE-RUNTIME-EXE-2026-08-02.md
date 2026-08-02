# CpIPOS Windows Native Runtime EXE

Date: 2026-08-02
Status: MVP for Windows POS field testing

## Purpose

This runtime provides a real Windows executable for CpIPOS POS testing without waiting for Android or Codex follow-up work.

It is intended for Windows cashier/POS terminals that need:

- a fullscreen application window
- the existing CpIPOS web UI as the source of truth
- no browser address bar
- no Chrome Web Serial dependency
- a native local print bridge inside the same process
- fast field testing before the full offline sales engine is built

## Current CpIPOS behavior to preserve

- The existing web POS UI remains the main UI.
- The existing login flow remains unchanged:
  `/login/store -> branch selection -> employee verification -> device selection -> POS`.
- The existing backend, Supabase, RLS, session, payment, shift, and tenant logic are not replaced.
- Server-side tenant, branch, device, role, permission, and feature checks remain authoritative.
- Printing success must not block payment completion.

## Files

```text
apps/windows-runtime-native/Cpipos.WindowsRuntime/Cpipos.WindowsRuntime.csproj
apps/windows-runtime-native/Cpipos.WindowsRuntime/Program.cs
apps/windows-runtime-native/Cpipos.WindowsRuntime/MainForm.cs
apps/windows-runtime-native/Cpipos.WindowsRuntime/LocalPrintBridge.cs
.github/workflows/build-windows-runtime.yml
```

## Runtime architecture

```text
Cpipos.WindowsRuntime.exe
  -> Windows Forms app shell
  -> Microsoft WebView2 loads https://cp-ipos-web.vercel.app/login/store
  -> Native TCP local bridge listens on 127.0.0.1:3210
  -> Native .NET PrintDocument prints through Windows printer drivers
```

## Native bridge endpoints

```text
GET  http://127.0.0.1:3210/health
GET  http://127.0.0.1:3210/capabilities
GET  http://127.0.0.1:3210/printers
POST http://127.0.0.1:3210/print/test
POST http://127.0.0.1:3210/print
```

The bridge is implemented with `TcpListener`, not PowerShell and not Node.js. It does not need `node server.mjs`.

## Build artifact

GitHub Actions workflow:

```text
.github/workflows/build-windows-runtime.yml
```

Output artifact:

```text
CpIPOS-WindowsRuntime-win-x64.zip
```

Inside the ZIP:

```text
Cpipos.WindowsRuntime.exe
README-WINDOWS-RUNTIME.txt
```

## How to run on Windows POS terminal

1. Download `CpIPOS-WindowsRuntime-win-x64.zip` from GitHub Actions artifacts.
2. Extract the ZIP to a local folder, for example:

```text
C:\CpIPOS\WindowsRuntime
```

3. Run:

```powershell
.\Cpipos.WindowsRuntime.exe
```

4. For a specific Windows printer name:

```powershell
.\Cpipos.WindowsRuntime.exe --printer="MTP-II"
```

5. For debugging in windowed mode:

```powershell
.\Cpipos.WindowsRuntime.exe --windowed
```

## WebView keyboard shortcuts

- `F11`: toggle fullscreen/windowed
- `Ctrl+R`: reload CpIPOS URL
- `Ctrl+Shift+D`: open WebView2 DevTools

## Offline behavior in this MVP

This MVP includes an offline fallback page if the online CpIPOS web URL cannot load.

It does not yet implement:

- local product database
- offline order creation
- offline payment creation
- offline shift continuation
- sync queue
- duplicate prevention through idempotency keys

Therefore, it must not be treated as a complete offline sales engine yet.

## Future offline phase

The next phase should add:

```text
local_orders
local_order_items
local_payments
local_print_jobs
sync_queue
device_runtime_state
```

Required sync rules:

- use `local_id` and `idempotency_key`
- never sync across tenant/branch boundaries
- validate device/session scope with the server when online
- prevent duplicate orders and duplicate payments
- keep print success independent from payment success

## Security rules

- Do not put Supabase service role key in the Windows EXE.
- Do not store admin secrets in the EXE.
- Do not trust local tenant/branch/device data for server mutations.
- Do not bypass current CpIPOS login, session, permission, or feature gate rules.
- Do not enable cross-tenant sync.

## Acceptance checklist

- [ ] EXE opens a fullscreen Windows app window.
- [ ] EXE loads the existing CpIPOS web UI.
- [ ] Login flow is unchanged.
- [ ] `GET /health` returns bridge online.
- [ ] `GET /printers` returns installed Windows printers.
- [ ] `POST /print/test` prints to the selected/default printer.
- [ ] No Chrome Web Serial is required.
- [ ] No Node.js bridge process is required.
- [ ] No web production route is changed.
- [ ] Offline fallback page appears when internet is unavailable.
- [ ] Full offline sales is clearly marked as future phase, not included in MVP.
