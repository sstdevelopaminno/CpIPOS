# CpIPOS Windows Drawer Controller Bridge

Date: 2026-08-04
Branch: `agent/windows-drawer-controller-bridge`

## Goal

CpIPOS Windows Runtime must support product-grade cash drawer opening for different store hardware setups. A store must not become unable to open the cash drawer just because the receipt printer is out of paper, jammed, or has a stuck print queue.

## Implemented in this branch

### 1. Separate print queue and drawer queue

`LocalPrintBridge.cs` now has separate semaphores:

- `_printLock` for receipt/test printing
- `_drawerLock` for cash drawer commands

This keeps a long receipt print job from blocking a drawer command at the bridge queue level.

Important limitation: if the drawer is physically connected through the receipt printer, printer hardware errors can still block the pulse. A fully independent drawer requires an external controller.

### 2. Supported drawer modes in Windows bridge

The bridge now accepts drawer metadata through `POST /cash-drawer/open` and drawer jobs sent through `/print`.

Supported modes:

- `printer-kick`
- `emergency-printer-kick`
- `external-serial-controller`
- `external-network-controller`

Explicitly not yet enabled:

- `external-usb-controller` unless the USB trigger appears as a COM port
- `vendor-sdk` until a vendor-specific SDK adapter exists

### 3. Printer kick / emergency printer kick

Uses raw Windows spooler output and sends ESC/POS drawer pulse bytes.

Default bytes are derived from:

- `drawer_kick_pin`
- `drawer_pulse_on_ms`
- `drawer_pulse_off_ms`

The default command is equivalent to:

```text
ESC @ ESC p m t1 t2
```

### 4. External serial controller

For USB cash drawer triggers that appear as a Windows COM port.

Expected metadata examples:

```json
{
  "drawer_connection_mode": "external-serial-controller",
  "drawer_controller_port": "COM3",
  "drawer_command_hex": "1B 70 00 19 FA"
}
```

If `drawer_command_hex` is omitted, the bridge sends the default ESC/POS drawer pulse bytes.

### 5. External network controller

For LAN/TCP/HTTP relay controllers.

TCP example:

```json
{
  "drawer_connection_mode": "external-network-controller",
  "drawer_controller_url": "tcp://192.168.1.50:9100",
  "drawer_command_hex": "1B 70 00 19 FA"
}
```

HTTP example:

```json
{
  "drawer_connection_mode": "external-network-controller",
  "drawer_controller_url": "http://192.168.1.60/open",
  "drawer_command_hex": "1B 70 00 19 FA"
}
```

For HTTP, the bridge sends a POST with `application/octet-stream` bytes.

## Bridge capabilities

`GET /capabilities` now reports:

- `supports_cash_drawer_printer_kick`
- `supports_cash_drawer_emergency_printer_kick`
- `supports_external_serial_drawer_controller`
- `supports_external_network_drawer_controller`
- `supports_external_usb_drawer_controller: false`
- `supports_vendor_sdk_drawer_controller: false`

`GET /health` reports:

- `print_queue_busy`
- `drawer_queue_busy`
- `drawer_commands`
- `last_drawer_at`
- `last_drawer_device`

## Local validation

Run on Windows:

```powershell
cd E:\CpIPOS
git fetch origin
git checkout agent/windows-drawer-controller-bridge
git pull --ff-only origin agent/windows-drawer-controller-bridge

& "C:\Program Files\dotnet\dotnet.exe" publish ".\apps\windows-runtime-native\Cpipos.WindowsRuntime\Cpipos.WindowsRuntime.csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o ".\artifacts\CpIPOS-WindowsRuntime-win-x64"
```

## Product status

This branch adds Windows runtime support for external serial/network drawer controllers. It does not yet add a full UI page for dedicated drawer controller profiles. The current backend metadata contract can already pass mode/controller data to the bridge.
