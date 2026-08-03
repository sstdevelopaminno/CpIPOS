# Multi-device Shift and Print Stability 2026-08-03

## Scope

This change set addresses the first production issues found after Windows Runtime 0.1.5:

1. Same employee code used on multiple cashier devices in one branch caused another device to be logged out.
2. Current shift and sales list could be mixed across devices when a branch-level/null-device shift was reused.
3. POS order list in the sales UI showed branch-level orders instead of the active cashier terminal shift.
4. Windows Local Print Bridge did not advertise or execute cash drawer open commands.
5. Local bridge adapter did not route cash drawer commands to the Windows cash drawer endpoint.

## Changes

### POS session isolation

`createPosSession()` no longer revokes every active session for the same employee in the same branch.

Device exclusivity remains the responsibility of `/api/auth/devices/select`, which checks active sessions for the selected device before creating the new session.

Expected result:

- The same employee may work on two registered cashier devices in the same branch.
- Logging into cashier B must not revoke cashier A unless both choose the same device and an override is permitted.

### Current shift isolation

`/api/pos/shifts/current` now treats `device_code` as the cashier terminal boundary.

When the session has a device code and the schema supports `shifts.device_code`, the API returns only shifts for that device. It no longer treats null-device shifts as automatically joinable across every cashier terminal.

Expected result:

- Each cashier terminal opens or joins only its own terminal shift.
- Sales totals and close-shift summaries should not be mixed across machines.

### POS order list isolation

`GET /api/pos/orders` now resolves the current POS session and active shift, then filters order rows by the active shift ID.

Expected result:

- Sales list in the POS sales UI shows the current cashier shift only.
- Machine 1 and Machine 2 no longer see one shared branch-level sales list.

### Windows cash drawer support

Windows Local Print Bridge now supports cash drawer opening through ESC/POS raw pulse:

- `POST /cash-drawer/open`
- `POST /print` with `action = cash_drawer_open`
- `POST /print` with metadata/payload command `open_cash_drawer`

The bridge capabilities endpoint now reports `supports_cash_drawer = true`.

Expected result:

- When receipt printer profile cash drawer metadata is enabled, the Web POS cash drawer command can be sent through the Windows local bridge.
- The command is serialized through the same bridge lock as print jobs to avoid simultaneous print/pulse collisions.

## Important operational notes

Cash drawer support depends on hardware wiring and printer driver behavior:

- The drawer must be physically connected to the receipt printer's DK port.
- The Windows printer driver must allow RAW spool data.
- Standard ESC/POS pulse is used: `ESC @`, `ESC p m t1 t2`.
- Pin defaults to `0`, pulse on defaults to `50ms`, pulse off defaults to `250ms`.

Exact drawer open/closed physical status is still unsupported unless the printer/driver exposes bidirectional status.

## Validation required

Run Web checks:

```powershell
cd E:\CpIPOS
git fetch origin
git checkout agent/multi-device-shift-print-stability
git pull --ff-only origin agent/multi-device-shift-print-stability
corepack pnpm --filter backoffice-web typecheck
corepack pnpm --filter backoffice-web exec vitest run --cache false
corepack pnpm --filter backoffice-web exec eslint src scripts tests next.config.ts eslint.config.mjs --cache --cache-location ..\..\.tmp-eslintcache --no-error-on-unmatched-pattern
corepack pnpm --filter backoffice-web build
```

Run Windows build:

```powershell
cd E:\CpIPOS
& "C:\Program Files\dotnet\dotnet.exe" publish ".\apps\windows-runtime-native\Cpipos.WindowsRuntime\Cpipos.WindowsRuntime.csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o ".\artifacts\CpIPOS-WindowsRuntime-win-x64"
```

Manual QA:

1. Register two active branch devices, for example cashier 1 and cashier 2.
2. Login with the same employee code on both devices.
3. Confirm both remain logged in.
4. Open a shift on cashier 1 and cashier 2 separately.
5. Create a sale on each device.
6. Confirm sales list and close-shift totals are separated by active shift.
7. Use dine-in/table mode on both devices and confirm one terminal action does not log out the other.
8. Enable cash drawer metadata on a receipt printer profile.
9. Open drawer from POS and confirm the printer sends a drawer pulse.
