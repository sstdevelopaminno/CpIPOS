# Offline Grocery POS Checkout Foundation

This phase expands the static Offline POS shell toward real grocery/convenience-store operation while keeping the online POS flow isolated.

## Added behavior

- POS-like offline sales screen with sidebar, shift/device header, product grid, and right cart panel.
- Barcode/QR input: scan or type a product code and press Enter to add the item to cart.
- Unknown barcode fallback: opens an offline manual-item entry panel.
- Manual offline item entry for emergency sales when catalog data is missing.
- Cash checkout popup before saving a bill.
- Cash received and change calculation.
- Saves each offline sale as one bill in the `offline_sales` IndexedDB queue.
- Offline sales list view for bills stored on the device.
- Print existing offline bill action from the sales list.
- Cash drawer command through the configured Local Bridge endpoint.
- Receipt print command through the configured Local Bridge endpoint.

## Safety boundary

This is an offline device-local POS foundation. It does not introduce remote control, screen capture, key logging, private file inspection, arbitrary command execution, or background hardware control from the server.

Drawer and receipt actions are initiated from the local offline UI and use the existing Local Bridge token/session already injected by CpIPOS Windows Runtime.

## Known next phases

- Sync engine: submit queued offline bills back to the server when online.
- Server-side conflict handling for receipt numbers and duplicate products.
- Offline stock decrement and reconciliation.
- Offline product catalog editor with audit trail.
- Owner/manager PIN for long offline mode and sensitive actions.
- Receipt template parity with online receipt format.
- Drawer/print result logging into offline bill metadata.
