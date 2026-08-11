# Printer / Cash Drawer / MDM Closure Checkpoint — 2026-08-12

This checkpoint closes the source-side hardening work before deploy for the Printer Connection Manager v2 flow.

## Target

```text
Device: POS-COUNTER-01
Printer: XP-58
Runtime target: Windows Runtime / Local Bridge 0.1.8
Customer-facing setup modes: LAN / USB / Bluetooth only
Production path: Runtime / Local Bridge first; Browser Web Serial fallback/debug only
Quarantined stale queue: do not replay
```

## What is now source-ready

### 1. Printer settings UI v2

File:

```text
apps/backoffice-web/src/components/backoffice/printer-connection-manager-v2.tsx
```

Behavior:

- Shows only `LAN`, `USB`, and `Bluetooth` as customer-facing modes.
- Calls `/api/backoffice/printers/discover?mode=lan|usb|bluetooth` from the auto-discovery action.
- Supports multiple functions on one printer by saving `metadata.print_functions`.
- Supports `58mm` and `80mm` paper sizes.
- Keeps Runtime / Local Bridge / Android / MDM / Browser Web Serial as internal transports.
- Adds test actions for receipt print and cash drawer.

### 2. Unified discovery endpoint

File:

```text
apps/backoffice-web/src/app/api/backoffice/printers/discover/route.ts
```

Behavior:

- Normalizes configured profiles and active print agents into `lan`, `usb`, or `bluetooth` candidates.
- Preserves legacy `NETWORK_ESC_POS` profiles as `lan` when v2 metadata is not present.
- Surfaces Android/MDM agents as Bluetooth candidates when metadata/app hints say Android or Bluetooth.

### 3. Cash drawer test from printer settings

Files:

```text
apps/backoffice-web/src/app/api/backoffice/printers/drawer-test/route.ts
apps/backoffice-web/src/lib/printing/cash-drawer-controller-service.ts
```

Behavior:

- The selected table row's `printer_id` is passed through to `openCashDrawerController`.
- Drawer candidate selection is scoped to the selected receipt printer when `printerId` exists.
- Drawer commands keep `quarantine_replay_allowed=false` in metadata.
- Cooldown is scoped by selected printer when possible.
- The command is a new drawer job only; it does not replay quarantined stale jobs.

### 4. Print-agent drawer event sync

Files:

```text
apps/backoffice-web/src/lib/printing/drawer-event-agent-sync.ts
apps/backoffice-web/src/app/api/print-agent/v1/jobs/[jobId]/ack/route.ts
apps/backoffice-web/src/app/api/print-agent/v1/jobs/[jobId]/fail/route.ts
```

Behavior:

- When Runtime/Print Agent ACKs a drawer job, the matching `cash_drawer_events` row is moved from `queued` to `sent`.
- When Runtime/Print Agent fails a drawer job, the matching event is moved to `failed`.
- Event metadata records `print_agent_id`, `print_agent_device_code`, `print_job_status`, `provider_job_id`, `bytes_sent`, and `synced_from_print_agent_at`.
- Drawer event sync failure is logged but does not break ACK, preventing a fresh printed job from being converted into a false API failure.

### 5. Read-only smoke status endpoint

File:

```text
apps/backoffice-web/src/app/api/backoffice/printers/smoke-status/route.ts
```

Default target:

```text
/api/backoffice/printers/smoke-status?device=POS-COUNTER-01&printer=XP-58
```

Checks:

- Fresh `POS-COUNTER-01` print-agent heartbeat within 10 minutes.
- Runtime app version includes `0.1.8`.
- XP-58 profile or Runtime candidate is visible.
- Fresh receipt print job reached `printed`.
- Fresh drawer event reached `sent`, `open`, or has agent-sync evidence.
- No job/event has `quarantine_replay_allowed=true`.

The endpoint is read-only and never replays old jobs.

## Required source checks before deploy

Run from repo root:

```bash
pnpm --filter backoffice-web exec tsc -p tsconfig.json --noEmit --pretty false
pnpm --filter backoffice-web build
```

Do not deploy if either command fails.

## Production smoke after deploy

1. Open Printer Settings.
2. Confirm only `LAN`, `USB`, `Bluetooth` are visible as modes.
3. Select USB.
4. Click auto-discovery.
5. Select or create `POS-COUNTER-01 / XP-58`.
6. Set paper `58mm`.
7. Set runtime/agent code `POS-COUNTER-01`.
8. Select functions:

```text
ใบเสร็จ
ลิ้นชักเงินสด
พิมพ์ซ้ำ
```

9. Save the profile.
10. Upgrade Runtime on the machine from `0.1.5` to `0.1.8` if still old.
11. Confirm Runtime/Agent heartbeat is fresh.
12. Click `พิมพ์ทดสอบ`.
13. Confirm the new print job reaches `printed`.
14. Click drawer test.
15. Confirm the new drawer event reaches `sent` / agent-sync evidence.
16. Call smoke status:

```text
GET /api/backoffice/printers/smoke-status?device=POS-COUNTER-01&printer=XP-58
```

Close only when:

```json
{
  "fresh_runtime_heartbeat": true,
  "runtime_0_1_8_seen": true,
  "xp58_profile_or_runtime_visible": true,
  "receipt_printed_seen": true,
  "drawer_event_seen": true,
  "quarantine_replay_detected": false,
  "ready_to_close": true
}
```

## Do not close if

- Runtime is still `0.1.5`.
- `POS-COUNTER-01` heartbeat is stale.
- Receipt job is only `pending`, `printing`, `retrying`, or `failed`.
- Drawer event is only `queued` with no agent sync.
- Any quarantined job is replayed.
- Browser Web Serial is the only working path.
