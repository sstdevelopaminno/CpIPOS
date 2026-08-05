# CpIPOS Offline App Shell Foundation

## Purpose

This phase makes the web/PWA layer fail over to a cached offline POS shell when the cashier device loses internet connectivity.

The scope is intentionally limited to the app-shell foundation. It does not replace the full online POS payment flow yet.

## What this phase adds

- `apps/backoffice-web/public/offline-pos.html`
  - Static offline POS shell cached by the service worker.
  - Reads the latest `cpipos-offline-sale` IndexedDB catalog snapshot.
  - Displays products and categories from the latest snapshot.
  - Allows a simple offline cash cart.
  - Writes queued offline cash sale entries into the existing `offline_sales` object store.

- `apps/backoffice-web/public/sw.js`
  - Bumps the cache name to `cpipos-shell-v2`.
  - Pre-caches `/offline-pos.html`.
  - Handles navigation requests before API bypass rules.
  - Falls back to `/offline-pos.html` when navigation fails offline.
  - Keeps `/api/auth`, `/api/pos`, and `/api/windows-runtime` network-only.

## Expected behavior

When the device is online:

1. The cashier logs in and opens the normal POS screen.
2. The app caches catalog snapshots in IndexedDB after the POS sales API loads successfully.
3. The service worker installs and caches the offline shell.

When the device loses internet:

1. Local Bridge remains available at `127.0.0.1:3210`.
2. Navigation requests can fall back to `/offline-pos.html`.
3. The offline shell reads the latest local catalog snapshot.
4. Cash sales can be queued locally for a later sync phase.

## Safety boundaries

This phase does not add:

- server sync of offline orders,
- automatic cash drawer opening from the static offline shell,
- receipt printing from the static offline shell,
- stock deduction,
- tax/invoice finalization,
- subscription bypass,
- remote commands,
- screen capture,
- key logging,
- private file inspection.

## Next phases

1. Offline Cash Checkout Queue integration with the normal POS UI.
2. Offline receipt generation and print queue.
3. Sync engine to push queued sales to the server.
4. IT Device Health Center visibility for queued offline sales.
5. Owner/manager PIN policy for 30-day offline grace and 45-day hard sync lock.
