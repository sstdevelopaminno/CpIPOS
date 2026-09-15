# CpIPOS POS - Android Tablet

`apps/pos-android` is the managed Android Tablet POS runtime for the shared CpIPOS Web POS reference UI.

## Runtime identity

- Package: `com.cpipos.pos`
- Stable source baseline: **1.0.12 / versionCode 18**
- Modern managed build: **1.0.22 / versionCode 30**
- Minimum Android SDK: 26
- Runtime: hardened Android WebView shell using the shared Web POS UI and server APIs
- Default entrypoint: `https://cp-ipos-web.vercel.app/login/store`
- Product/file selection: Android System Document Picker (`ACTION_OPEN_DOCUMENT`)
- Storage model: scoped app/WebView storage; **no** broad `MANAGE_EXTERNAL_STORAGE` / All-files permission
- Printer readiness: network + Bluetooth/Nearby connectivity permissions and USB-host capability declaration
- MDM: app-level heartbeat/diagnostics plus Android Device Admin / Device Owner enrollment foundation
- Server remains authoritative for tenant/branch/device/session/order/payment/stock rules

## Managed-device provisioning

Interactive Device Admin enrollment is bundled and requested once on an unmanaged install. Full Android Enterprise Device Owner provisioning must be performed by IT on a freshly provisioned/factory-reset managed POS terminal during enrollment.

Device Owner capability is a management foundation, not permission to bypass CpIPOS authorization. Destructive/device-wide policies must be issued only from the authenticated and audited IT Admin control plane.

The app deliberately does **not** expose remote shell, silent wipe, arbitrary file browsing, or arbitrary APK-install commands through the public/app-level MDM heartbeat endpoint.

## Printer and nearby-device permissions

Android 12+ requests Bluetooth Scan/Connect when needed. Android 13+ also requests Nearby Wi-Fi Devices. Network printers continue to use normal network access. USB-host capability is declared for compatible native printer bridges; per-device USB consent still follows Android's USB permission model.

## Verified staged Android updates

Stable 1.0.12 remains on the `stable` update channel and does not opt into Modern updates automatically. Modern builds are produced with the managed updater explicitly enabled and use the `modern` channel.

The staged updater accepts only a server-issued update offer and verifies all of the following before Android PackageInstaller receives the APK:

- target version is newer than the installed build;
- release manifest matches the expected package, channel, versionName and versionCode;
- APK SHA-256 matches the signed release manifest;
- APK package name is `com.cpipos.pos`;
- APK signing certificate matches the protected CpIPOS release certificate trust anchor;
- download and manifest URLs stay on the CpIPOS production HTTPS host.

`REQUEST_INSTALL_PACKAGES` is used only by this verified updater. It does not grant automatic silent installation by itself.

For a terminal that is **not** Android Device Owner, PackageInstaller requires Android/user confirmation. For a correctly provisioned Device Owner terminal, the updater can request user-action-free installation where the Android/OEM policy permits it.

Protected customer stores such as FG0003 remain fail-closed. The control plane will issue a staged offer only when the installed runtime reports the verified updater capability and the registered POS device is explicitly `maintenance` and `is_locked=true`.

A legacy installation that predates the staged updater cannot bootstrap itself into the new updater silently. That first transition requires a one-time Android-confirmed installation of an updater-capable signed build. Subsequent updates can use the staged MDM contract; truly silent subsequent updates additionally require Device Owner provisioning.

## Build

Requires JDK 17 and Android SDK 34.

Stable source smoke build:

```bash
cd apps/pos-android
gradle :app:assembleDebug
```

Modern updater-capable build uses the dedicated workflow `.github/workflows/build-android-modern-runtime.yml` and the Gradle overrides:

```text
-PcpiposVersionName=1.0.22
-PcpiposVersionCode=30
-PcpiposUpdateChannel=modern
-PcpiposManagedUpdater=true
```

The Modern release workflow validates the protected signing certificate, builds the signed release APK, verifies package/version/signature, generates the APK SHA-256 manifest, uploads the workflow artifact, and publishes the versioned assets to `android-runtime-modern-1.0.22` after a production-branch push.

The normal `.github/workflows/build-android-runtime.yml` continues to protect and publish the Stable 1.0.12 release contract independently.
