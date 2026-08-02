# Local Print Bridge for Windows — 2026-08-02

## Purpose

Use this bridge as the primary printing path for CpIPOS on Windows cashier machines.

Chrome Web Serial was unstable on some receipt printer / Bluetooth SPP / virtual COM driver combinations and repeatedly failed with:

```text
Failed to execute 'open' on 'SerialPort': Failed to open serial port.
```

The production-safe model is now:

```text
CpIPOS Web POS on Vercel
→ http://127.0.0.1:3210/print
→ CpIPOS Local Print Bridge on the cashier machine
→ Windows printer driver / default printer
→ receipt printer
```

## Files

```text
tools/local-print-bridge-windows/package.json
tools/local-print-bridge-windows/server.mjs
tools/local-print-bridge-windows/start-bridge.bat
```

## Start Bridge

Open PowerShell or Command Prompt:

```powershell
cd E:\CpIPOS\tools\local-print-bridge-windows
node server.mjs
```

Or double-click:

```text
tools/local-print-bridge-windows/start-bridge.bat
```

The bridge listens on:

```text
http://127.0.0.1:3210
```

Health check:

```text
http://127.0.0.1:3210/health
```

Print endpoint:

```text
http://127.0.0.1:3210/print
```

## Optional Printer Name

By default the bridge prints to the Windows default printer.

To force a specific Windows printer name:

```powershell
$env:CPIPOS_WINDOWS_PRINTER="MTP-II"
node server.mjs
```

Use the exact printer name shown in Windows Settings > Printers & scanners.

## POS Settings

In CpIPOS printer settings:

```text
Bridge URL: http://127.0.0.1:3210/print
```

Do not use Web Serial as the primary printing path on machines that show `SerialPort.open()` failures.

## Browser / Vercel Requirements

The bridge returns CORS and Private Network Access headers:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Private-Network: true
```

This is required because the web app is served from Vercel while the bridge runs on `127.0.0.1`.

## Troubleshooting

### bridge_health_failed

Means the web app cannot reach `127.0.0.1:3210`.

Check:

1. Bridge is running.
2. Windows firewall allows Node.js local network access.
3. URL is exactly `http://127.0.0.1:3210/print`.
4. Open `http://127.0.0.1:3210/health` in the browser on the cashier machine.

### Printer does not print

Check:

1. Windows default printer is the receipt printer, or set `CPIPOS_WINDOWS_PRINTER`.
2. Printer driver is installed and can print a Windows test page.
3. Paper and power are ready.

### Web Serial error still appears

Do not use Web Serial on this machine. Use Local Bridge mode.

The Web Serial path remains only as an optional diagnostic path for printers and drivers that can reliably open a serial port from Chrome.

## Development Guardrail

Future AI/development work must not re-enable Chrome Web Serial as the default printing path for Windows cashier machines. Local Bridge / Print Station should be treated as the stable production path.
