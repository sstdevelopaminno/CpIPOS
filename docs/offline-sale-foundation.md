# CpIPOS Offline Sale Foundation

## Goal

CpIPOS Windows must remain operational for cash sales when internet access is temporarily unavailable. This foundation is intentionally scoped to local-first cash sale continuity and later sync back to the server.

## Current foundation scope

This PR adds a typed browser/Windows local storage layer backed by IndexedDB:

- Local catalog snapshots for products, categories, tables, tax rules, and promotions.
- Offline cash sale queue.
- Device-scoped offline receipt numbers.
- Sync lifecycle states: `queued`, `syncing`, `synced`, `failed`, `voided`.
- Summary helpers for operator UI and sync diagnostics.

Primary module:

```text
apps/backoffice-web/src/lib/pos-offline-sale-store.ts
```

## Offline receipt number policy

Offline sales use device-scoped receipt numbers:

```text
OFF-{BRANCH_CODE-}{DEVICE_CODE}-{YYYYMMDD}-{000001}
```

Example:

```text
OFF-NDL-ONNUT-01-POS-COUNTER-01-20260805-000001
```

This keeps multiple cashier machines from generating the same receipt number while offline.

## Mode rules

### Online Mode

- Server remains the source of truth.
- Orders, payments, stock, shift summaries, and audit logs are written online.
- Printing and drawer commands use the Windows Local Bridge when available.

### Offline Sale Mode

Allowed when:

- The Windows app has a previously valid POS session/device context.
- A recent catalog snapshot exists for the tenant/branch/device.
- A shift context is present or an emergency offline shift policy is enabled.

Allowed actions:

- Cash sale from cached catalog.
- Local receipt number creation.
- Local receipt printing through the Windows Local Bridge.
- Cash drawer open through the Windows Local Bridge.
- Queue sale for server sync after connectivity returns.

Blocked actions in this foundation stage:

- Bank transfer / QR payment settlement.
- Backoffice catalog edits.
- Stock correction without manager approval.
- Cross-device shift closing.
- Deleting offline sales after cash is accepted.

### Emergency Cash Mode

Emergency mode should be a stricter variant of Offline Sale Mode:

- Cash only.
- Cached products only.
- Device-local receipt numbers only.
- Requires audit flag and visible operator banner.
- Sync is mandatory before final branch close.

## Sync lifecycle

1. `queued` — sale is stored locally and has not been synced.
2. `syncing` — sync worker has picked the sale and is sending it to the server.
3. `synced` — server accepted the sale and returned a server order ID.
4. `failed` — sync failed and can be retried.
5. `voided` — local sale was voided through an approved offline correction flow.

Payment commit rule:

> If a cash sale is accepted offline, drawer/print/sync failures must not erase the local sale. The sale stays queued until it is synced or approved for correction.

## Required next integrations

### Phase 1 — Foundation, this PR

- Add IndexedDB offline store module.
- Add documented policy and lifecycle.
- No production flow change yet.

### Phase 2 — Catalog cache writer

- After successful online product/table/settings load, save a branch catalog snapshot.
- Expose last snapshot time in POS diagnostics.

### Phase 3 — Offline sale UI gate

- Detect `navigator.onLine === false` and API connectivity failures.
- If a valid snapshot exists, show “Offline Sale Mode”.
- If not, block selling and show recovery instructions.

### Phase 4 — Offline cash checkout

- Convert cart to `OfflineCashSaleInput`.
- Enqueue locally with `enqueueOfflineCashSale`.
- Print receipt and open drawer through Local Bridge.
- Show unsynced bill count in the POS UI.

### Phase 5 — Sync worker

- When online returns, list queued/failed offline sales.
- Mark each as `syncing`.
- POST to server sync endpoint with idempotency key.
- Mark as `synced` or `failed`.
- Preserve audit metadata: tenant, branch, shift, user, device, offline receipt number, local created time, sync time.

### Phase 6 — Server sync endpoint

- Add a dedicated endpoint, for example:

```text
POST /api/pos/offline-sales/sync
```

Responsibilities:

- Validate POS session/device/branch.
- Enforce idempotency by offline sale ID/order number.
- Create server order/payment rows.
- Attach audit log fields.
- Return server order ID and sync status.

## Store data safety

- IndexedDB content is local to the Windows profile/browser data folder.
- Offline records are not a replacement for server backup.
- Every offline sale must be synced before final daily settlement.
- Admin should have a diagnostics screen to export unsynced queue if the device is damaged or cannot reconnect.

## Test checklist

- Turn internet off after POS session and catalog are loaded.
- Verify cached catalog snapshot exists.
- Create an offline cash sale.
- Confirm local receipt number starts with `OFF-`.
- Confirm Local Bridge opens the cash drawer.
- Confirm receipt print command is queued/sent locally.
- Turn internet back on.
- Confirm sale changes from `queued` to `synced`.
- Confirm server order ID is recorded.
- Confirm shift report separates online sales, offline unsynced sales, and offline synced sales.

