# CpIPOS Android POS Stable Signing Migration

Date: 2026-08-12
Runtime: `apps/pos-android`
Package: `com.cpipos.pos`
Target runtime: `1.0.3` (`versionCode 9`)

## Current migration state

The installed 1.0.2 test terminal is still an ephemeral-debug-signed build. Android requires an APK update to use the same application ID and the same signing certificate as the installed package, so the first stable-signed release cannot update that debug installation in place.

The Android 1.0.3 source contains the deterministic HTML receipt raster fix and the stable release signing configuration. The re-pair flow is also implemented: after a fresh install and authenticated device selection, the native Android install id is rebound to the selected POS device before the print agent bootstrap continues.

This means the one-time uninstall/install migration should be performed only after the stable 1.0.3 release APK has been successfully built, certificate-verified and published.

## Permanent signing identity

From the stable-signing migration onward, publishable Android POS APKs must use one dedicated CpIPOS release signing key stored only as GitHub Actions repository secrets plus a secure offline backup.

The repository includes a local Windows helper:

`scripts/android/create-stable-signing.ps1`

Run it from the repository root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\android\create-stable-signing.ps1 -ConfigureGitHub
```

The helper:

- creates `cpipos-android-release.jks` under `%USERPROFILE%\CpIPOS-Signing`, outside the repository;
- generates strong local signing passwords;
- prints the certificate SHA-256 fingerprint;
- writes a private local `github-actions-secrets.txt` recovery/setup file;
- when `gh` is installed and authenticated, configures the four required GitHub Actions repository secrets automatically;
- refuses to overwrite an existing stable keystore.

Required GitHub Actions repository secrets:

- `ANDROID_SIGNING_KEYSTORE_BASE64`
- `ANDROID_SIGNING_STORE_PASSWORD`
- `ANDROID_SIGNING_KEY_ALIAS`
- `ANDROID_SIGNING_KEY_PASSWORD`

After generating the new permanent signing key, update `ANDROID_SIGNING_CERT_SHA256` in `.github/workflows/build-android-runtime.yml` to the SHA-256 value printed by the helper. Only the public certificate fingerprint should be shared for this update; never share the keystore or passwords in chat or commit them to Git.

The workflow validates the keystore certificate fingerprint before building and validates the produced APK certificate again before upload/release publication. A debug APK must never be published as the managed Android POS release again.

## One-time device migration from debug 1.0.2 to stable 1.0.3

1. Do not uninstall 1.0.2 until the stable-signed 1.0.3 APK is published and its signing certificate is verified by CI.
2. Open CpIPOS POS 1.0.2 and log out if possible so the server-side POS session is closed cleanly.
3. If Android refuses uninstall because CpIPOS POS is an active Device Admin, deactivate only the CpIPOS POS Device Admin role first. Do not factory-reset the device.
4. Uninstall the old debug-signed `com.cpipos.pos` package.
5. Install the stable-signed CpIPOS Android POS 1.0.3 APK.
6. Re-authorize Android permissions requested for USB/Bluetooth/nearby-device printer connectivity.
7. Log in again and select the intended POS device. The authenticated device-selection flow will bind the new Android install id to that POS device.
8. Wait for the Android Print Agent to bootstrap and heartbeat.
9. Run XP-58 printer connectivity/test print.
10. Print a real Thai receipt and verify that HTML-to-raster rendering completes without `receipt_html_render_timeout` or mojibake/`????` output.
11. Verify the printer device status changes from `needs_check` to `online` only after a real successful print result.
12. Proceed to Kitchen E2E only after receipt printing is stable across app restart/reconnect.

## Data impact

`AndroidManifest.xml` uses `android:allowBackup="false"`. Uninstall removes app-local state such as HTTP/session cookies, local Android MDM install id and native runtime preferences. Business data such as tenants, branches, products, orders, payments and shifts remains server-side and is not deleted by uninstalling the Android package.

The printer configuration used by the web/server-side printer settings remains in Supabase. Native runtime permissions may need to be granted again after the one-time reinstall.

## Release pipeline requirements

- Production/distributed APK: `assembleRelease`, stable signed only.
- Debug builds are CI smoke builds only and must never be published as production release assets.
- A manual release must fail when stable signing secrets are unavailable.
- The expected signing certificate fingerprint must be pinned in the workflow.
- Preserve the stable keystore indefinitely. Losing the private key prevents future in-place updates for all devices migrated to the stable signing identity.
- Keep an offline backup of `cpipos-android-release.jks` and its credentials in a secure location separate from the repository.
- Never commit `.jks`, `.keystore`, base64 keystore material, passwords or private keys.

## Acceptance criteria

The printer/runtime migration is complete only when all of the following are true:

- GitHub Actions has all four stable signing secrets configured.
- The workflow fingerprint matches the permanent signing certificate.
- CI builds `assembleRelease`, verifies the APK signature and publishes `CpIPOS-Android-POS-1.0.3.apk`.
- The test terminal runs version 1.0.3 after the one-time migration.
- Authenticated POS device selection automatically re-pairs the new Android install id.
- Print Agent heartbeat and claim remain active after app restart.
- XP-58 test print succeeds.
- Thai receipt content prints correctly through HTML-to-raster ESC/POS without timeout or corrupted Thai characters.
- XP-58 status becomes `online` after a successful physical print.
- A future stable-signed version can update over 1.0.3 without uninstalling the app.
