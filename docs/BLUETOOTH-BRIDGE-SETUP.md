# Bluetooth Bridge Setup (Web + App)

Date: 2026-05-25
Updated: 2026-08-06 — see `docs/POS-BLUETOOTH-PRINT-DRAWER-2026-08-06.md` for the current, verified state of both Bluetooth paths (Windows OS-paired printer, and the new direct browser Web Bluetooth agent for Android/tablets).

This guide enables 58mm receipt printing through Bluetooth for:
- POS web app (desktop browser)
- POS app integration (calling same backend print path)

Two distinct paths exist today. Do not confuse them:

1. **Windows + OS-paired Bluetooth printer**: pair the printer in Windows first (`Devices > Bluetooth & other devices > Add printer`), then configure it as a normal `LOCAL_BRIDGE` printer profile (recommended) or `BLUETOOTH_BRIDGE` profile (also fixed and working as of 2026-08-06). Windows' print driver handles the Bluetooth transport; the bridge never talks Bluetooth directly.
2. **Android/tablet browser with no PC or native app**: the browser connects directly to the printer over Web Bluetooth (GATT). See `docs/POS-BLUETOOTH-PRINT-DRAWER-2026-08-06.md` section "Android Web Bluetooth agent".

## 1. Pair Printer at OS Level
1. Pair Bluetooth printer on cashier machine.
2. Confirm printer can print test page from vendor utility/OS.
3. Keep printer always connected and charged.

## 2. Start Local Bridge Service
Bridge must expose HTTP endpoint (example):
- `POST http://127.0.0.1:3210/print`

Request payload from POS may include:
- `payload_text`: fallback text payload
- `payload_html`: full HTML receipt (58mm)
- `metadata.transport = "bluetooth"`
- `metadata.print_format = "html_58mm"` when HTML is sent

## 3. Configure POS Printer Profile
In `/backoffice/settings/printers`:
1. Role: `receipt`
2. Connection type: `BLUETOOTH_BRIDGE`
3. Paper: `58mm`
4. Metadata JSON:
```json
{
  "bridge_url": "http://127.0.0.1:3210/print",
  "bluetooth_address": "AA:BB:CC:DD:EE:FF",
  "auto_connect": true,
  "connect_before_print": true,
  "prefer_html_58mm": true
}
```

## 4. Web App Behavior
- On receipt modal `พิมพ์ใบเสร็จ`:
  1. POS sends HTML 58mm to `/api/pos/receipts/bluetooth`
  2. Backend forwards to enabled `BLUETOOTH_BRIDGE` receipt printers
  3. If no Bluetooth printer configured, POS falls back to browser print dialog
  4. Bridge receives `auto_connect` / `connect_before_print` to reconnect printer automatically.

## 4.1 Discovery + Auto Connect API
- `POST /api/backoffice/printers/bluetooth/discover`
  - Scans Bluetooth devices through bridge.
- `POST /api/backoffice/printers/bluetooth/connect`
  - Connects selected Bluetooth device and returns bridge response.

## 5. App Integration Behavior
Native app can call the same backend endpoint:
- `POST /api/pos/receipts/bluetooth`
Body:
```json
{
  "order_id": "uuid-or-null",
  "order_no": "TKO-xxxx",
  "receipt_html": "<!doctype html>...</html>"
}
```

## 6. Recommended Env
Set at backend runtime:
```env
PRINT_BLUETOOTH_BRIDGE_URL=http://127.0.0.1:3210/print
PRINT_BRIDGE_URL=http://127.0.0.1:3210/print
```
