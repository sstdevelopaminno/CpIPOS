# Offline POS Polish PR Notes

This note records the validation intent for the offline grocery UI polish branch.

## Manual test focus

1. Open CpIPOS online once and let the service worker cache `cpipos-shell-v4`.
2. Enter the POS sales screen and confirm catalog snapshot is available.
3. Disconnect the internet and verify `/offline-pos.html` loads.
4. Scan or type a barcode/SKU and press Enter.
5. Confirm the matched product is added to cart.
6. Scan an unknown code and confirm the manual offline product popup opens.
7. Add a manual product and confirm it is added to cart.
8. Press `ชำระเงิน / บันทึกการขาย`.
9. Enter cash received and confirm change calculation.
10. Confirm an offline sale is saved to IndexedDB `offline_sales`.
11. Open the left `รายการขาย` menu and confirm the bill is listed.
12. Test local bridge drawer/print commands from the offline flow.

## Known limitation

This branch does not implement server sync. Offline bills stay queued until a later sync-engine phase.
