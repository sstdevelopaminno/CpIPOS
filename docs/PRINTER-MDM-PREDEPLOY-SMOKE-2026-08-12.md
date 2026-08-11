# Printer / Cash Drawer MDM Pre-deploy Smoke — 2026-08-12

Scope: harden the new Printer Connection Manager v2 before deploying to Production and then verify `POS-COUNTER-01`, XP-58, receipt printing, cash drawer kick, Windows Runtime / Local Bridge, Android / MDM, and job/event status without replaying quarantined queues.

## Non-negotiable guardrails

- Do not replay quarantined print jobs from the stale Print Agent queue.
- Do not treat Browser Web Serial as the Production path. It stays fallback/debug because browser permission and user gesture are required.
- The Production path is Windows Runtime / Local Bridge for cashier USB printers and Android / MDM for Android Bluetooth/bridge cases.
- A drawer command being queued is not physical proof unless the Runtime/MDM reports back through job/event status.
- The work is closed only after a fresh test receipt reaches `printed` and a fresh drawer command creates a drawer event such as `drawer_kicked` / sent drawer event status.

## Source changes included in this batch

- `apps/backoffice-web/src/components/backoffice/printer-connection-manager-v2.tsx`
  - Calls `/api/backoffice/printers/discover?mode=lan|usb|bluetooth` from the "ค้นหาอัตโนมัติ" button.
  - Displays only LAN / USB / Bluetooth as customer-facing modes.
  - Keeps Runtime, Local Bridge, Android, MDM, Browser Web Serial as internal transports.
  - Lets one printer profile map to multiple functions through `metadata.print_functions`.
  - Adds direct test buttons for receipt print and cash drawer test.
- `apps/backoffice-web/src/app/api/backoffice/printers/discover/route.ts`
  - Normalizes existing profiles and print agents into LAN / USB / Bluetooth candidates.
  - Correctly preserves `NETWORK_ESC_POS` as LAN when no v2 metadata exists.
- `apps/backoffice-web/src/app/api/backoffice/printers/drawer-test/route.ts`
  - Sends a new cash drawer test command from printer settings.
  - Marks metadata with `quarantine_replay_allowed=false`.
  - Uses `openCashDrawerController`; it does not replay old jobs.

## Pre-deploy local/source checks

Run from repo root:

```bash
pnpm --filter backoffice-web exec tsc -p tsconfig.json --noEmit --pretty false
pnpm --filter backoffice-web build
```

If either fails, fix source before deployment. Do not deploy based only on visual inspection.

## Production/MDM smoke sequence after deploy

Target device/printer:

```text
Device: POS-COUNTER-01
Printer: XP-58
Expected runtime: 0.1.8
Known old runtime on machine: 0.1.5
Old stale Print Agent queue: quarantined; do not replay
```

1. Open the deployed POS settings page and confirm the menu shows only:

```text
LAN
USB
Bluetooth
```

2. Click `ค้นหาอัตโนมัติ` in USB mode.

Expected:

```text
POS-COUNTER-01 / XP-58 or Windows Runtime candidate is visible
Source shows Windows Runtime / Local Bridge
Status is online/checking, not stale critical
```

3. Save or reconnect the XP-58 profile with:

```text
Mode: USB
Paper: 58mm
Runtime/Agent code: POS-COUNTER-01
Functions: ใบเสร็จ + ลิ้นชักเงินสด + พิมพ์ซ้ำ
```

4. Trigger MDM/Runtime refresh.

Preferred command source:

```text
POST /api/android-pos/mdm/heartbeat
Header x-cpipos-android-pos: true
Header x-cpipos-install-id: <device install id>
Header x-cpipos-app-version: <current android version>
```

Optional safe command through Vercel env when the Android agent is the active test path:

```json
[
  {
    "id": "printer-smoke-20260812",
    "action": "test_printer_connection",
    "reason": "printer_drawer_predeploy_smoke"
  }
]
```

Use this only for the intended test device window. Remove or clear the env command after the smoke test to avoid repeated device-side tests.

5. Verify Runtime heartbeat.

Expected:

```text
POS-COUNTER-01 heartbeat fresh
Runtime reports 0.1.8 after upgrade
No false-critical offline status from Web/Android latency mismatch
```

6. Click `พิมพ์ทดสอบ` on the XP-58 row.

Expected:

```text
A fresh print job is created
Runtime/Agent claims the new job
XP-58 prints the test receipt
Job status becomes printed
No quarantined job is replayed
```

7. Click `เปิดลิ้นชัก` on the XP-58 row.

Expected:

```text
A fresh drawer test job is created
Drawer opens through ESC/POS drawer kick
cash_drawer_events receives a new event
The job/event metadata shows printer_settings_v2 and quarantine_replay_allowed=false
```

8. Confirm Android / MDM path when Android Bluetooth is used.

Expected:

```text
Android/MDM heartbeat accepted
Bluetooth candidate can be selected from the UI
Test action does not expose UUID/secret/baud rate to normal users
Receipt/drawer commands use the bridge/runtime event path instead of Browser-only Web Serial
```

## Close criteria

The Printer + Drawer work is ready to deploy only when:

- TypeScript and build pass.
- Printer settings UI shows exactly LAN / USB / Bluetooth to customers.
- Discovery API returns sane candidates for USB Runtime and LAN fallback.
- `POS-COUNTER-01` Runtime/MDM heartbeat is fresh.
- XP-58 receipt test reaches `printed`.
- Drawer test creates a fresh drawer event and does not replay quarantined work.
- Browser Web Serial remains fallback/debug, not the required Production path.
