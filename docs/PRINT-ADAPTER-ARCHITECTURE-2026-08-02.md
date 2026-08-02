# CpIPOS Print Adapter Architecture 2026-08-02

Last reviewed: 2026-08-02 11:49 Asia/Bangkok

## Decision

CpIPOS must not depend on Chrome Web Serial as the default print path. Real store environments use mixed devices: Windows cashier PCs, Android tablets, iPads, phone hotspots, Wi-Fi, LAN, USB, Bluetooth, and sometimes no stable local network. The printing layer must support multiple adapters and choose the safest adapter per store setup.

## Default adapter policy

### Default for Windows cashier / small shop

```text
LOCAL_BRIDGE_WINDOWS
POS Web -> http://127.0.0.1:3210/print -> Windows printer driver -> printer
```

This is the default path for a single Windows cashier PC or mini PC. It does not use Web Serial from Chrome.

### Default for Android tablet

```text
ANDROID_PRINT_BRIDGE
POS Web/PWA -> Android native bridge app -> Bluetooth / USB OTG printer
```

This adapter is planned as an external Android app. Do not make Chrome Web Bluetooth or Chrome Web Serial the default path for Android.

### Default for iPad / iOS

```text
AIRPRINT_OR_LAN_BRIDGE
POS Web/PWA -> AirPrint / LAN printer / local print station
```

iOS Chrome/Safari should not be expected to print directly to common Bluetooth thermal printers.

### Default for multi-register / larger shops

```text
CLOUD_PRINT_QUEUE
POS Web -> cloud print_jobs -> store print station -> local printer
```

Cloud queue is the correct architecture for multiple sales terminals, kitchen printers, and branch-level printer routing. The cloud stores the queue; a local print station in the shop claims and prints jobs.

### Experimental only

```text
WEB_SERIAL_EXPERIMENTAL
Chrome Web Serial -> serial printer
```

This is not the default anymore. It may be used only for lab testing or validated hardware. Enable only by setting:

```js
localStorage.setItem("cpi_browser_print_agent_web_serial_experimental_v1", "1")
```

## Current implementation status

### Implemented now

- `LOCAL_BRIDGE_WINDOWS` bridge app in `tools/local-print-bridge-windows`
- POS host defaults to `bridge_print_station` instead of Web Serial
- Web Serial agent is mounted only when explicitly enabled as experimental
- Bridge endpoints:
  - `GET /health`
  - `GET /capabilities`
  - `GET /printers`
  - `POST /print/test`
  - `POST /print`

### Existing queue foundation

- `print_jobs`
- print agent claim/ack/fail APIs
- auto print jobs after payment
- printer profiles

These are the foundation for `CLOUD_PRINT_QUEUE`, but the default small-shop path is now local bridge.

### Planned adapters

- Android native print bridge for Bluetooth / USB OTG printer
- iOS/AirPrint or LAN bridge integration
- LAN print station mode using `CPIPOS_PRINT_BRIDGE_HOST=0.0.0.0`
- full cloud print station that polls/claims cloud jobs and prints locally

## Supported packages

### Package A: small shop Windows

```text
Windows notebook / mini PC
+ POS Web
+ Local Bridge
+ Windows printer driver
+ USB/Bluetooth/LAN thermal printer
```

### Package B: Android tablet shop

```text
Android tablet
+ POS Web/PWA
+ Android Print Bridge app
+ Bluetooth/USB OTG printer
```

### Package C: iPad shop

```text
iPad
+ POS Web/PWA
+ AirPrint/LAN printer
or Windows mini print station
```

### Package D: larger shop

```text
Many POS devices
+ cloud print_jobs
+ one or more store print stations
+ receipt/kitchen/bar printers
```

## Offline behavior

No internet does not mean the printer cannot print. The required condition is local connectivity between the sales device and the printer/bridge.

### Same Windows cashier PC

```text
POS/PWA already loaded -> 127.0.0.1 bridge -> Windows printer
```

### Local LAN available but no internet

```text
Tablet/POS -> LAN IP print bridge -> printer
```

This requires the bridge to bind on LAN, for example:

```powershell
$env:CPIPOS_PRINT_BRIDGE_HOST="0.0.0.0"
node server.mjs
```

### No internet and no LAN/Wi-Fi

Only the device physically connected to the printer can print.

## Local Bridge commands

```powershell
cd E:\CpIPOS\tools\local-print-bridge-windows
node server.mjs
```

Health:

```text
http://127.0.0.1:3210/health
```

Capabilities:

```text
http://127.0.0.1:3210/capabilities
```

Printers:

```text
http://127.0.0.1:3210/printers
```

Test print:

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3210/print/test"
```

Use a specific Windows printer:

```powershell
$env:CPIPOS_WINDOWS_PRINTER="MTP-II"
node server.mjs
```

LAN mode:

```powershell
$env:CPIPOS_PRINT_BRIDGE_HOST="0.0.0.0"
$env:CPIPOS_WINDOWS_PRINTER="MTP-II"
node server.mjs
```

## Important rule for future AI work

Do not re-enable Web Serial by default. Browser Web Serial is experimental only. The stable path for Windows is `LOCAL_BRIDGE_WINDOWS`; future Android/iOS work should be done as native bridge adapters or LAN/AirPrint adapters, not browser serial hacks.
