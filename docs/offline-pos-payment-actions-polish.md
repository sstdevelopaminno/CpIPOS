# Offline POS Payment and Action Modal Polish

## Summary

This phase polishes the static Offline POS shell so it better matches the online sales workflow and the expected grocery/convenience-store checkout experience.

## Changes

- Reworked the cash payment dialog to align with the online payment popup pattern:
  - large payable amount
  - received cash input
  - quick amount buttons
  - numeric keypad
  - computed change
  - confirm payment action
- Renamed the primary cart action to `ชำระเงิน / บันทึกการขาย`.
- Moved `เพิ่มสินค้า Offline` and `โหลดข้อมูลในเครื่อง` into the Settings modal instead of showing them as top-level sale-screen buttons.
- Made sidebar actions non-dead:
  - `รายการขาย` opens local offline sales history.
  - `เปิด/ปิดกะ` opens a local offline shift notice/control dialog.
  - `เพิ่มเติม` opens an offline limitations/help dialog.
  - `ตั้งค่า` opens offline product/load/bridge tools.
- Made cart quick actions useful:
  - `พักบิล` saves/opens held offline bills.
  - `สมาชิก` opens an under-development member modal matching online behavior.
  - `ส่วนลด` opens a discount configuration modal.
- Barcode/QR scan flow adds matching products directly to cart; unknown codes open the offline product popup.
- Paid cash sales are saved to the local `offline_sales` queue and can be viewed/reprinted from the sales list.
- Drawer and receipt actions remain routed through the local bridge with the existing bridge token contract.
- Bumped the Service Worker cache to `cpipos-shell-v5` so deployed clients receive the new offline shell.

## Current limitations

- Offline bills are queued locally but not yet synced to the server.
- Offline manual product creation is local-only until the sync/reconcile phase.
- Offline member lookup remains a placeholder.
- Advanced shift reconciliation, tax reconciliation, stock reconciliation, and owner override policies are future phases.

## Safety boundary

This phase does not introduce remote control, screen capture, key logging, private file inspection, or arbitrary command execution. Hardware actions are limited to the existing local bridge drawer/print commands.
