# Printer Connection Manager v2 — 2026-08-12

Status: design checkpoint for CpIPOS Printer + Cash Drawer redesign.

## Context

This checkpoint continues the post Deploy + MDM work:

- Deploy + MDM baseline is closed.
- `POS-COUNTER-01` is healthy after Production reload.
- The previous MDM false-critical condition was corrected.
- Test printer: `XP-58`.
- Browser Web Serial printing already worked at `9600` baud.
- Cash drawer already opened with an ESC/POS drawer-kick command.
- The old stale Print Agent queue from 6 Aug is quarantined and must not be replayed.
- Source/runtime target is Windows Runtime / Local Bridge `0.1.8`; the field machine was previously observed at `0.1.5`.

## Product Goal

Redesign the printer settings experience so a normal shop owner can configure printers without developer knowledge.

The user-facing menu must expose only three connection modes:

1. `LAN`
2. `USB`
3. `Bluetooth`

Internal transports such as Browser Web Serial, Windows Runtime, Local Bridge, Android Bridge, and MDM remain implementation details. They should not be presented to customers as primary setup modes.

## Functional Requirements

### Printer capacity

- Support unlimited printers per tenant.
- Scope printers by tenant and branch.
- Allow each branch to have separate print zones/functions.
- Use pagination for long printer lists.

### Assignments

A single printer must be assignable to multiple functions, for example:

- receipt
- kitchen ticket
- drink ticket
- bar ticket
- reprint
- shift report
- payment slip
- cash drawer

Example:

```text
POS-COUNTER-01 / XP-58 / USB / 58mm
→ receipt + reprint + cash_drawer
```

### Paper widths

- Support `58mm` and `80mm`.
- Persist the selected paper width with the printer profile.

### Discovery and reconnection

- Provide guided automatic discovery.
- Windows Runtime / Local Bridge discovers USB/LAN printers on POS counters.
- Android/MDM discovers Bluetooth/LAN printers where supported.
- Store remembered device history so the same model/brand can be reconnected quickly after replacement.

### Status and events

Show customer-friendly status badges:

- online
- offline
- checking
- connecting
- needs_check
- disabled

Track operational events:

- heartbeat
- discovered
- connected
- disconnected
- print_started
- printed
- print_failed
- drawer_kicked
- drawer_failed
- quarantined

### Cash drawer

- Cash drawer is not a separate customer-facing connection mode.
- Cash drawer is a capability/function routed through a printer profile that supports ESC/POS drawer kick.
- The UI should show whether a printer is linked to `cash_drawer`.
- Test actions should include receipt test and drawer test when supported.

## UI Requirements

The settings page should be structured as a simple guided workflow:

```text
1. เลือกสาขา
2. เลือกโซน/เมนูพิมพ์
3. เลือกโหมด LAN / USB / Bluetooth
4. ค้นหาอัตโนมัติ
5. ทดสอบพิมพ์ / ทดสอบลิ้นชัก
6. บันทึกใช้งาน
```

Main visible sections:

1. Branch selector.
2. Print zone/function selector.
3. Three large mode cards: LAN, USB, Bluetooth.
4. Automatic discovery panel with plain-language help.
5. Connected printer table with pagination.
6. Remembered device history.
7. System link status: Web App, Android, MDM, Windows Runtime, Printer, Cash Drawer.
8. Collapsed advanced settings for IP/port/COM/baud/UUID/secret/metadata.

The main screen must avoid developer-first labels such as Agent secret, UUID, baud rate, local bridge URL, WebPRNT URL, and metadata JSON unless the user opens advanced settings.

## Suggested Data Contract

```ts
export type PrinterConnectionMode = "lan" | "usb" | "bluetooth";
export type PrinterPaperWidth = 58 | 80;
export type PrinterFunction =
  | "receipt"
  | "kitchen"
  | "drink"
  | "bar"
  | "reprint"
  | "shift_report"
  | "payment_slip"
  | "cash_drawer";
export type PrinterStatus =
  | "online"
  | "offline"
  | "checking"
  | "connecting"
  | "needs_check"
  | "disabled";
```

A runtime discovery payload should normalize Windows Runtime and Android/MDM results into the same shape:

```json
{
  "runtime_device_code": "POS-COUNTER-01",
  "runtime_version": "0.1.8",
  "source": "windows_runtime",
  "printers": [
    {
      "name": "XP-58",
      "mode": "usb",
      "paper_width": 58,
      "fingerprint": "xp58-usb-pos-counter-01",
      "capabilities": {
        "receipt": true,
        "cash_drawer": true,
        "cut": false
      }
    }
  ]
}
```

## Production Guardrails

- Do not replay quarantined print jobs.
- Keep Windows Runtime / Local Bridge as the preferred Production path for POS counters.
- Keep Browser Web Serial as fallback/debug because it requires browser permission and user gesture.
- Do not expose runtime secrets or service-role credentials to the browser.
- Use additive schema changes only; do not rename existing live tables/columns/RPCs for style.
- Keep changes isolated from POS sale, payment, shift, auth, and MDM production logic unless directly required.

## Acceptance Criteria

- The UI exposes only LAN, USB, and Bluetooth as customer-facing modes.
- A non-technical shop owner can add a printer without entering secret/UUID/baud/metadata.
- Unlimited printers are shown in a paginated table.
- The table shows branch, linked function/menu, paper width, status, last online time, and actions.
- One printer can be linked to multiple functions.
- The system preserves printer history for reconnect.
- Receipt test can produce `printed`.
- Drawer test can produce `drawer_kicked`.
- Existing quarantined jobs are not replayed.
