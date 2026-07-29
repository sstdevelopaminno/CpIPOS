# POS Printing And Receipt Audit 2026-07-29

Purpose: record the current receipt/printing state before and during print-agent/cash-drawer work.

## Scope Checked

- Existing print architecture docs:
  - `docs/PRINTER-ARCHITECTURE.md`
  - `docs/BLUETOOTH-BRIDGE-SETUP.md`
  - `docs/POS-SALES-FLOW.md`
  - `docs/POS-SHIFT-CLOSE-RELIABILITY-2026-07-10.md`
  - `docs/POS-SHIFT-CLEAR-OPEN-BILLS-2026-07-28.md`
- Existing print code:
  - `apps/backoffice-web/src/lib/printing/print-service.ts`
  - `apps/backoffice-web/src/lib/printing/bridge-contract.ts`
  - `apps/backoffice-web/src/lib/printing/adapters/local-bridge-adapter.ts`
  - `apps/backoffice-web/src/lib/printing/adapters/bluetooth-bridge-adapter.ts`
  - `apps/backoffice-web/src/app/api/pos/payments/route.ts`
  - `apps/backoffice-web/src/app/api/pos/receipts/bluetooth/route.ts`
  - `apps/backoffice-web/src/app/api/pos/receipts/[orderId]/reprint/route.ts`
  - `apps/backoffice-web/src/app/api/backoffice/printers/*`
  - `apps/backoffice-web/src/components/pos/pos-shift-cycle-guard.tsx`
  - `apps/backoffice-web/src/components/pos/pos-shift-history-module.tsx`

## Current Architecture

The system already has a print abstraction and queue:

- `printer_profiles` stores tenant/branch printers, role, paper width, connection type, and metadata.
- `print_jobs` stores queued jobs with status `pending`, `printing`, `retrying`, `printed`, or `failed`.
- Supported adapters in code:
  - `NETWORK_ESC_POS`
  - `STAR_WEBPRNT`
  - `LOCAL_BRIDGE`
  - `BLUETOOTH_BRIDGE`
- Bluetooth support was added after the initial printer migration by `202605250001_add_bluetooth_bridge_connection_type.sql`.
- POS monitor already reads print queue depth and recent failed prints.
- Payment success is intentionally independent from print success.

## Sales Flow Findings

`POST /api/pos/payments` correctly completes payment first, then handles printing in a separate `try/catch`.

This is good:

- Print failure does not roll back a paid order.
- Print overload writes `pos_print_dead_letter`.
- Response includes `print_jobs_queued` and `print_warning`.

Main bottleneck:

- The payment request still does print-related work synchronously after payment:
  - counts open print queue depth
  - reloads order and order items
  - creates print jobs
  - `enqueuePrintJobsForOrderSnapshot(...)` processes jobs immediately
- If bridge/network printer is slow, the cashier can feel payment completion is slow even though payment already succeeded.

Recommended next change:

- Payment endpoint should enqueue jobs quickly and return.
- A local/agent worker should claim and process jobs outside the payment request.

## Bridge Adapter Findings

`LOCAL_BRIDGE` and `BLUETOOTH_BRIDGE` adapters call `fetch(bridgeUrl, ...)` without an explicit timeout.

Risk:

- If a local bridge, USB printer, Bluetooth stack, or LAN printer hangs, the API request can wait too long.
- This is especially risky when the adapter is called inside payment, test print, reprint, or Bluetooth receipt modal.

Recommended next change:

- Add adapter timeout with `AbortController`.
- Default timeout should be short, for example 4-8 seconds for bridge calls.
- Make timeout configurable by env or printer metadata.
- Return a normal failed print job, not a failed payment.

## Receipt And Reprint Findings

Receipt/reprint paths already use existing queue service:

- `/api/pos/receipts/bluetooth` queues and processes Bluetooth HTML receipt jobs.
- `/api/pos/receipts/[orderId]/reprint` requires manager/owner PIN.
- `/api/backoffice/orders/[orderId]/reprint` uses the same `reprintOrderReceipt(...)` service.

Risk:

- Reprint also processes the job inside the request. If printer hardware hangs, UI can wait.
- Bluetooth receipt modal has browser print fallback, which is useful for web/PWA, but it is not restaurant-grade hardware reliability.

Recommended next change:

- Keep browser print fallback as emergency fallback only.
- Add worker-driven print status and retry so reprint can return "queued" quickly.

## Shift Close Findings

Shift-close recovery is currently separate from printing, which is correct.

Important guardrails:

- Do not block shift close because a receipt or report did not print.
- Do not remove open-bill blocker.
- Keep `clear_open_bills: true` recovery behavior for overdue shift handoff.
- Shift close print/report should be optional; the shift should remain closed even when print fails.

Potential UI issue:

- `pos-shift-history-module.tsx` Thai copy still says Bluetooth print is required before branch selection in one label, while English says it is optional. Future UI work should align Thai wording with actual behavior if the button is not truly required.

## Recommended Production Direction

For stable 58mm/80mm receipt printing, use:

1. Web POS creates payment/order and enqueues `print_jobs`.
2. Local Windows/Electron Print Agent runs on the cashier machine.
3. Agent is paired to tenant/branch/device.
4. Agent polls or subscribes to assigned `print_jobs`.
5. Agent sends ESC/POS to USB/LAN/Bluetooth printer locally.
6. Agent updates job status to `printed`, `retrying`, or `failed`.
7. POS UI monitors status and allows reprint.

Cloud-only printing cannot reliably reach USB/Bluetooth printers inside the store without a local agent/bridge.

## Next Implementation Slice

Recommended low-risk order:

1. Add explicit timeout to local bridge and Bluetooth bridge adapters. Done locally in the print-agent v1 slice. Bluetooth settings health/discover/connect API routes now use the same server-side timeout helper so a missing bridge cannot hold the request indefinitely.
2. Add a versioned print-agent API contract document. Done locally in `docs/POS-PRINT-AGENT-V1-DESIGN-2026-07-29.md`.
3. Add server routes for agent heartbeat, claim job, ack printed, fail/retry. Done locally under `/api/print-agent/v1/*`.
4. Add settings UI for create/revoke print-agent secrets with one-time secret display. Done locally under printer settings.
5. Add manual cash drawer support with printer-profile metadata, 3s cooldown, POS button, and `cash_drawer_events` audit. Done locally.
6. Keep existing web print routes working during transition. Still required.
7. Move payment printing from process-inside-request to enqueue-only after agent routes exist. Pending.
8. Add automatic drawer open after committed cash payment only. Pending.

## Do Not Do

- Do not send arbitrary raw ESC/POS bytes from the browser.
- Do not put printer bridge URLs, Bluetooth MACs, or local device secrets in customer-facing public settings without access control.
- Do not claim the drawer physically opened unless status feedback is supported.
- Do not make receipt printing a hard requirement for payment success or shift close.
- Do not hard-code vendor-specific BLE UUIDs, COM ports, or SDK assumptions without exact printer hardware.
