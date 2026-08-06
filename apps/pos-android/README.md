# CpIPOS Android Runtime (Phase 1)

Fullscreen Android WebView shell around the existing CpIPOS web POS UI. Read
`docs/ANDROID-APK-PHASE1-2026-08-06.md` and `docs/ANDROID-FULLSCREEN-APK-RUNTIME-PLAN.md`
before changing anything here.

- Package: `com.cpipos.pos`
- Min SDK: 33 (Android 13+), target SDK 34
- Loads `https://cp-ipos-web.vercel.app/login/store` fullscreen, landscape-locked, tablet+ only
- Native bridge (`window.CpIPOSBridge`): read-only `getAppVersion`/`getBridgeVersion`/`getDeviceInfo`/`getNetworkStatus` only — no print/drawer/order/payment methods yet

This app does **not** reimplement POS UI natively. `apps/backoffice-web` remains the
source of truth for login, sales, payment, receipts, and backoffice screens.

## Build

No Android SDK is assumed to be installed locally for this repo's AI/CI setup. The
GitHub Actions workflow `.github/workflows/build-android-runtime.yml`
(`workflow_dispatch`, manual trigger) builds a debug APK and publishes it to the
`android-runtime-latest` GitHub Release, downloadable from `/download/android` on the
web app.

If you have Android Studio / a local Android SDK, you can build directly:

```
cd apps/pos-android
gradle :app:assembleDebug
```

There is no committed Gradle wrapper (`gradlew`/`gradle-wrapper.jar` are binary and are
intentionally not hand-authored here — see the doc above for why). Generate one locally
if you want `./gradlew`:

```
gradle wrapper --gradle-version 8.9
```
