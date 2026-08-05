# Offline POS Polish Grocery UI

## Purpose

This phase improves the CpIPOS offline POS shell so it is closer to the online sales screen and more suitable for grocery/convenience-store usage when internet access is unavailable for an extended period.

## Scope

- Keep the left navigation visually aligned with the online POS shell.
- Add functional offline menu actions instead of dead buttons.
- Improve separate scrolling for product grid and cart panel.
- Make the primary sales action explicit: `ชำระเงิน / บันทึกการขาย`.
- Support barcode/QR scan input with Enter-to-add behavior.
- Add a manual offline product popup when scanned code is not found.
- Add cash checkout popup with total, cash received, change, and confirmation.
- Save each completed offline cash bill to IndexedDB `offline_sales` with `status: queued`.
- Show offline sales history from the left `รายการขาย` menu.
- Send optional cash drawer open and receipt print commands through the local bridge after a bill is saved.
- Bump service worker cache to `cpipos-shell-v4` so deployed clients pick up the new offline shell.

## Safety and limitations

- Offline sales are not synced to the server in this phase.
- Offline manual products are local-only and must be reconciled after sync is implemented.
- Offline shift status is local-only and must be reconciled with the server later.
- Discounts, members, tax rules, and stock deduction are intentionally limited until the sync/reconcile layer is implemented.
- Local bridge actions require the CpIPOS Windows Runtime token already injected into browser storage.

## Next phases

1. Offline sync engine for queued bills.
2. Server-side reconciliation and conflict handling.
3. Offline receipt template parity with online receipts.
4. Offline stock movement queue.
5. Owner/manager PIN policy for long offline grace periods.
