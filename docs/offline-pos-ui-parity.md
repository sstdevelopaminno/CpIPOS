# CpIPOS Offline POS UI Parity

## Purpose

This phase makes the static offline POS shell visually align more closely with the main CpIPOS sales screen so cashiers do not feel that offline mode is a different system.

## Scope

- Keep `/offline-pos.html` as a static service-worker-cacheable app shell.
- Use a POS-like two-column layout: product area on the left and cart/checkout area on the right.
- Add sales-mode tabs, category pills, search, item cards, totals, cash received, change, and queued offline cash sale creation.
- Preserve the existing IndexedDB offline queue contract from `pos-offline-sale-store.ts`.

## Deliberate safety boundary

This phase still does not open the cash drawer or print receipts from the static shell. Hardware actions must be routed through the authenticated Windows Runtime/local bridge flow in a later phase.

## Expected behavior

1. User opens CpIPOS online at least once and visits the sales page.
2. The online sales page saves a catalog snapshot to IndexedDB.
3. Service worker caches `/offline-pos.html`.
4. When the network is offline and navigation fails, service worker falls back to `/offline-pos.html`.
5. The offline shell loads the latest catalog snapshot, shows a POS-like UI, accepts cash input, and queues a cash sale in `offline_sales`.

## Next phases

- Offline drawer/receipt bridge actions through Windows Runtime only.
- Offline sync engine for queued cash sales.
- Offline queue dashboard in IT/backoffice.
- Conflict handling and server-side replay protection for synced offline orders.
