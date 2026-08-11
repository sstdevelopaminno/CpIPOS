# CpIPOS POS - Android Tablet

`apps/pos-android` is the managed Android Tablet POS runtime for the shared CpIPOS Web POS reference UI.

## Version 1.0.0 baseline

- Package: `com.cpipos.pos`
- Runtime: hardened Android WebView shell using the shared Web POS UI and server APIs
- Default entrypoint: `https://cp-ipos-web.vercel.app/login/store`
- Product/file selection: Android System Document Picker (`ACTION_OPEN_DOCUMENT`) so operators can choose permitted files from Photos, Files, Google Drive, and compatible document providers
- Storage model: scoped app/WebView storage; **no** broad `MANAGE_EXTERNAL_STORAGE` / All-files permission
- Printer readiness: network + Bluetooth/Nearby connectivity permissions and USB-host capability declaration
- MDM: app-level heartbeat/diagnostics plus Android Device Admin / Device Owner enrollment foundation
- Launcher icon: canonical CpIPOS Web App 512px icon
- Server remains authoritative for tenant/branch/device/session/order/payment/stock rules

## Managed-device provisioning

Interactive Device Admin enrollment is bundled and requested once on an unmanaged install. Full Android Enterprise Device Owner provisioning must be performed by IT on a freshly provisioned/factory-reset managed POS terminal during enrollment.

Device Owner capability is a management foundation, not permission to bypass CpIPOS authorization. Destructive/device-wide policies must be issued only from the authenticated and audited IT Admin control plane.

The app deliberately does **not** expose remote shell, silent wipe, arbitrary file browsing, or unaudited destructive commands through the public/app-level MDM heartbeat endpoint.

## Printer and nearby-device permissions

Android 12+ requests Bluetooth Scan/Connect when needed. Android 13+ also requests Nearby Wi-Fi Devices. Network printers continue to use normal network access. USB-host capability is declared for compatible native printer bridges; per-device USB consent still follows Android's USB permission model.

## APK update note

`REQUEST_INSTALL_PACKAGES` is declared as groundwork for a future authenticated/staged MDM updater. It does not grant automatic silent install by itself. Silent managed updates require Device Owner/enterprise provisioning plus the IT Admin rollout policy.

## Build

Requires JDK 17 and Android SDK 34.

```bash
cd apps/pos-android
gradle :app:assembleDebug
```

GitHub Actions workflow `.github/workflows/build-android-runtime.yml` validates pull-request builds and publishes the latest APK on the production integration branch. `/download/android/latest` continues to resolve the compatibility asset `CpIPOS-Android-debug.apk`; release `android-runtime-latest` also includes `CpIPOS-Android-POS-1.0.0.apk`.

Current workflow output is a debug-signed sideload APK. Before long-term production distribution/automatic update, configure a stable protected Android signing keystore so installed versions share the same signing identity across CI runs.
