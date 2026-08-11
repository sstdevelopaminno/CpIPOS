# CpIPOS Android POS 1.0.0 + Product Media Final UI

Date: 2026-08-11

## Product Media UI

- `แสดงสรุป / ซ่อนสรุป` is promoted into the page header on desktop/POS-size screens.
- Summary remains collapsed by default.
- Product Media uses the page's single outer frame; the nested inner section border/shadow is removed by page-scoped presentation rules.
- The product list uses a shorter bounded viewport (`34vh` on normal POS-height screens) so the existing Previous / page / Next footer is surfaced earlier on a 1365x768 terminal.
- On taller displays the list can expand again.
- Existing search, 10-item pagination, Add/Edit/Delete Image, quota, upload, Sales image and Table QR behavior remains unchanged.

## Android Tablet POS 1.0.0

- `versionCode=6`, `versionName=1.0.0`.
- Web file inputs are bridged to Android `ACTION_OPEN_DOCUMENT`, allowing operator-selected media from Photos, Files, Google Drive, and compatible document providers.
- Scoped storage remains the baseline. `MANAGE_EXTERNAL_STORAGE` / All-files access is not requested.
- Printer/network capability declarations include Wi-Fi/network, Bluetooth Scan/Connect, Nearby Wi-Fi Devices, legacy Bluetooth compatibility, and USB-host capability.
- `REQUEST_INSTALL_PACKAGES` is declared only as groundwork for a future authenticated/staged Device Manager updater; it does not provide silent install on its own.
- Android Device Admin receiver and Device Owner readiness are bundled for managed terminals.
- Device Admin enrollment is requested once on unmanaged installs; full Device Owner provisioning still requires enterprise/factory-reset enrollment by IT.
- Existing MDM heartbeat remains allowlisted and app-scoped. Destructive device-wide commands remain intentionally excluded until the IT Admin control plane can authorize and audit them.
- Launcher adaptive icon now reuses the canonical CpIPOS Web App icon asset.

## Release / signing boundary

The current GitHub workflow publishes a debug-signed sideload APK for compatibility with the existing Android release/download flow. Before treating automatic/staged updates as a long-term production channel, configure a stable protected Android signing keystore and verify upgrade/rollback on pilot devices.

## Next IT Admin phase

The next management work package should complete:

- Device Owner provisioning/bootstrap runbook and enrollment UX;
- authenticated Device Manager command issuance;
- command audit and approval policy;
- staged APK rollout/download/hash/signature verification;
- install/restart/post-update health confirmation;
- rollback/recovery;
- printer/USB/Bluetooth diagnostics and managed policy visibility.
