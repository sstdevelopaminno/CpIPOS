# CpIPOS Cash Drawer Controller Modes

Date: 2026-08-04
Branch: `agent/drawer-controller-modes`

## Why this exists

CpIPOS is a multi-tenant POS product for small shops, family shops, multi-counter stores, and multi-branch owners. Cash drawer opening must not depend on receipt printing alone. In real stores, a printer can be out of paper, jammed, offline, or have a stuck Windows print queue. A staff member may not have the physical drawer key, so the POS must support a safer and more resilient drawer architecture.

## Product rule

```text
Receipt printer failure must not automatically mean cash drawer failure.
Paper out must not automatically mean staff cannot open the drawer.
Drawer access must be auditable by tenant, branch, device, shift, user, reason, and timestamp.
```

## Supported controller mode model

CpIPOS now has a controller-mode abstraction in `cash-drawer-controller-service.ts`.

Supported normalized modes:

```text
printer-kick
emergency-printer-kick
external-usb-controller
external-serial-controller
external-network-controller
vendor-sdk
```

These are grouped into three commercial product modes.

### 1. Printer Kick

Hardware path:

```text
POS terminal -> receipt printer -> RJ11/RJ12 cash drawer
```

Use this for normal low-cost POS bundles.

Limitations:

- If the printer is out of paper, jammed, cover-open, driver-error, or queue-stuck, drawer opening may fail.
- Useful as default, but not enough for larger stores.

### 2. Emergency Drawer Open

Software behavior:

```text
Manual drawer open is separated from receipt printing and payment modal flow.
```

Requirements:

- Manual reason required by default.
- Owner/manager allowed by default.
- Staff can be allowed per drawer profile with `allowStaffManualOpen`.
- Every command writes a `cash_drawer_events` row and audit log.
- Cooldown prevents repeated accidental open commands.

This mode can still use printer-kick hardware, but the business operation is separated from receipt printing.

### 3. External Drawer Controller

Hardware path examples:

```text
POS terminal -> USB cash drawer trigger -> cash drawer
POS terminal -> Serial/COM drawer controller -> cash drawer
POS terminal -> LAN/Wi-Fi relay/controller -> cash drawer
```

Use this for shops where drawer access must survive printer failures.

Examples of future hardware classes:

- USB cash drawer trigger
- USB relay
- Serial/COM cash drawer controller
- LAN/Wi-Fi relay controller
- Vendor SDK drawer controllers

## Metadata contract

Printer or drawer controller profiles can use `metadata.cash_drawer`:

```json
{
  "cash_drawer": {
    "enabled": true,
    "connectionMode": "printer-kick",
    "openSupported": true,
    "statusSupported": false,
    "allowStaffManualOpen": false,
    "requireReason": true,
    "kickPin": 0,
    "pulseOnMs": 50,
    "pulseOffMs": 250,
    "autoOpenOnCashPayment": true
  }
}
```

External serial controller example:

```json
{
  "cash_drawer": {
    "enabled": true,
    "connectionMode": "external-serial-controller",
    "openSupported": true,
    "statusSupported": false,
    "allowStaffManualOpen": true,
    "requireReason": true,
    "controllerPort": "COM7",
    "controllerProtocol": "escpos",
    "kickPin": 0,
    "pulseOnMs": 50,
    "pulseOffMs": 250
  }
}
```

External network controller example:

```json
{
  "cash_drawer": {
    "enabled": true,
    "connectionMode": "external-network-controller",
    "openSupported": true,
    "statusSupported": true,
    "controllerUrl": "http://192.168.1.210/open",
    "controllerProtocol": "pulse"
  }
}
```

## Backend changes in this branch

New file:

```text
apps/backoffice-web/src/lib/printing/cash-drawer-controller-service.ts
```

Updated files:

```text
apps/backoffice-web/src/app/api/pos/cash-drawer/open/route.ts
apps/backoffice-web/src/lib/printing/adapters/local-bridge-adapter.ts
```

Behavior:

- `/api/pos/cash-drawer/open` now routes through the controller service.
- `GET /api/pos/cash-drawer/open` returns configured modes.
- `POST /api/pos/cash-drawer/open` accepts:

```json
{
  "reason": "change cash drawer",
  "mode": "external-serial-controller",
  "emergency": true
}
```

- Local Bridge payload now includes drawer mode and controller metadata.
- Print jobs continue to record metadata for diagnostics.

## Implementation status

Done in this branch:

- Controller mode abstraction.
- API routing through controller service.
- Audit/event integration.
- Metadata contract for printer-kick, emergency, and external controllers.
- Local Bridge adapter payload pass-through.

Still required for full hardware support:

- Windows native bridge implementation for serial/USB/network external controller commands.
- UI separation between printer profile and drawer controller profile.
- Device-level drawer controller health check.
- Hardware test matrix.

## Recommended hardware strategy

For small shops:

```text
Printer Kick via receipt printer is acceptable.
```

For shops where staff cannot access a physical key:

```text
Use External USB/Serial Drawer Controller.
```

For multi-branch owners:

```text
Require drawer events, staff permission policy, device scope, and shift scope.
```

## Test matrix before production

```text
1. Printer paper out + drawer open via printer-kick = expected fail or unsupported.
2. Printer paper out + external controller = drawer must open.
3. Staff manual open without permission = blocked.
4. Staff manual open with allowStaffManualOpen = allowed with reason.
5. Owner/manager emergency open = allowed with reason.
6. Repeated clicks within cooldown = blocked.
7. Cash payment auto-open = one drawer event per payment.
8. Device A drawer event must not appear as Device B shift operation.
```
