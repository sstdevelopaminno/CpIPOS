# CpIPOS Android POS Stable Signing Migration

Date: 2026-08-12
Runtime: `apps/pos-android`
Package: `com.cpipos.pos`
Target runtime: `1.0.2` (`versionCode 8`)

## Why the current 1.0.2 cannot update the installed 1.0.1

Android requires an APK update to use the same application ID and the same signing certificate as the installed package.

The previous CpIPOS Android workflow built `assembleDebug` on an ephemeral GitHub Actions runner. A new runner-generated Android debug keystore was therefore used for separate release runs. The installed 1.0.1 and the first published 1.0.2 were signed by different private keys/certificates, so Android correctly reports that the package conflicts with the existing package.

The private key that signed the already-installed 1.0.1 is not present in the repository and cannot be reconstructed from the APK certificate. Therefore there is no safe cryptographic way to create an APK that updates that particular 1.0.1 installation in place.

## Permanent signing identity

From the stable-signing migration onward, publishable Android POS APKs must use the dedicated CpIPOS release signing key stored only as GitHub Actions repository secrets / secure offline backup.

Expected stable certificate SHA-256:

`89e73a475a0e08091d79b24b40638a905ab9fcb96fe8cf186cfb763d378c05f0`

Required GitHub Actions repository secrets:

- `ANDROID_SIGNING_KEYSTORE_BASE64`
- `ANDROID_SIGNING_STORE_PASSWORD`
- `ANDROID_SIGNING_KEY_ALIAS`
- `ANDROID_SIGNING_KEY_PASSWORD`

The workflow validates the keystore certificate fingerprint before building and validates the produced APK certificate again before upload/release publication. A debug APK must never be published as the managed Android POS release again.

## One-time device migration from ephemeral-debug 1.0.1

This is a one-time migration only for devices that already have the old ephemeral-debug-signed package installed.

1. Open CpIPOS POS 1.0.1 and log out if possible so the server-side POS session is closed/cleared cleanly.
2. Record local printer configuration (printer IP/host and port, normally TCP 9100) because uninstalling the package removes local SharedPreferences.
3. If Android refuses uninstall because CpIPOS POS is an active Device Admin, deactivate the CpIPOS POS Device Admin role first. Do not factory-reset a managed device merely for this signing migration.
4. Uninstall the old `com.cpipos.pos` 1.0.1 package.
5. Install the stable-signed CpIPOS Android POS 1.0.2 package.
6. Re-authorize any Android permissions requested for printer connectivity / nearby devices.
7. Log in again, select the intended store/branch/device, and restore the printer host/port.
8. Run printer connectivity test, then print the CpIPOS Printer Test receipt.
9. Verify Thai text on a real receipt. Runtime 1.0.2 contains the HTML receipt raster path intended to avoid printer code-page corruption such as `????`.

## Data impact

`AndroidManifest.xml` intentionally uses `android:allowBackup="false"`. Uninstall therefore removes the app-local state rather than preserving it through Android backup.

Known local state includes:

- HTTP/session cookies used by the Android runtime;
- printer host/port SharedPreferences;
- Android MDM machine ID SharedPreferences.

Business records such as tenants, branches, products, orders, payments and shifts are server-side and are not deleted by uninstalling the Android package. A fresh local login/device selection is expected after the one-time migration.

## Release pipeline requirements

- Production/distributed APK: `assembleRelease`, stable signed only.
- Debug builds may be used only as CI smoke builds when signing secrets are unavailable; they are not uploaded or published as releases.
- The workflow must fail a manually requested release if stable signing secrets are absent.
- The expected signing certificate fingerprint is pinned in the workflow.
- Preserve the stable keystore indefinitely. Losing the key means future versions cannot update devices already migrated to stable signing.
- Never commit `.jks` or `.keystore` files, base64 keystore material, store passwords, key passwords or private keys to the public repository.

## Acceptance criteria

The migration is complete only when all of the following are true:

- GitHub Actions has all four stable signing secrets configured.
- A manual/push workflow produces a signed release APK and the certificate fingerprint equals the pinned stable SHA-256.
- The GitHub Release asset is the stable-signed APK, not a runner debug APK.
- A migrated test terminal shows version 1.0.2 after installation.
- The next test build (for example 1.0.3) can install over the stable-signed 1.0.2 without uninstalling it.
- Thai printer output is re-tested on the physical Xprinter after stable 1.0.2 is running.
