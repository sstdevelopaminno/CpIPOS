# Android APK Phase 1 — 2026-08-06

Branch: `agent/revert-raster-print-to-stable` (PR #31 into `agent-docs-preflight-schema-drift`)

## Status

**Phase 1 implemented and pushed. NOT yet build-verified — no Android SDK is available in the AI sandbox that wrote this code, so it has never actually been compiled.** The first real signal on whether it compiles comes from manually running the `Build CpIPOS Android Runtime` GitHub Actions workflow (`workflow_dispatch`, same trigger model as the existing Windows Runtime build). Read this whole document before touching `apps/pos-android` or the Android workflow.

## What this is

A minimal Android 13+ (`minSdk 33`) WebView shell that loads the existing CpIPOS web POS UI fullscreen, landscape-locked, tablet-and-up. This is Phase 1 of `docs/ANDROID-FULLSCREEN-APK-RUNTIME-PLAN.md` — read that doc (and its three siblings: `ANDROID-WEB-UI-AUTO-UPDATE-STRATEGY.md`, `ANDROID-MULTI-TENANT-DEVICE-REGISTRATION.md`, `ANDROID-NATIVE-BRIDGE-VERSIONING.md`) before extending this. Those docs were "documentation only, no code" before this round; this round is the first real Phase 1 implementation and intentionally does not go further than what they specify for Phase 1.

**The app does not reimplement any POS UI natively.** It is a thin shell — same principle as the Windows Runtime WebView2 app. All login, sales, payment, receipt, and backoffice logic remains in `apps/backoffice-web`.

## Why this exists / what triggered it

The user already has a separate download page for the Windows Runtime (`/download/windows-runtime`) and asked for the same for Android — a downloadable APK, separate from the main web app link, so there are three ways to run CpIPOS: web browser, Windows Runtime, Android APK.

## Package identity (do not change casually)

- `applicationId` / Kotlin package: `com.cpipos.pos` — chosen by the user explicitly. This is effectively permanent once real devices install the app; changing it later means a fresh install (loses whatever local app state exists) rather than an in-place update.
- App display name: `CpIPOS`.

## Project layout

```
apps/pos-android/
  settings.gradle.kts
  build.gradle.kts              (root — plugin versions only)
  gradle.properties
  .gitignore
  app/
    build.gradle.kts            (applicationId, minSdk 33, targetSdk 34, versionName 0.1.0)
    proguard-rules.pro          (unused placeholder — minifyEnabled is false in Phase 1)
    src/main/
      AndroidManifest.xml
      java/com/cpipos/pos/MainActivity.kt
      res/layout/activity_main.xml
      res/values/{strings,colors,themes}.xml
      res/drawable/ic_launcher_foreground.xml
      res/mipmap-anydpi-v26/ic_launcher.xml
```

### No Gradle wrapper jar committed — intentional, read before "fixing"

`gradlew` / `gradlew.bat` / `gradle-wrapper.jar` are **not** in this repo. `gradle-wrapper.jar` is a binary file; it cannot be safely authored by a text-editing AI tool, and a corrupted one would silently break every build. Instead:

- The CI workflow (`.github/workflows/build-android-runtime.yml`) provisions Gradle itself via `gradle/actions/setup-gradle@v4` (`gradle-version: "8.9"`) and invokes the plain `gradle` binary directly (`gradle :app:assembleDebug`), not `./gradlew`. This works without a wrapper present and is a fully supported use of that action.
- If a human developer wants to use `./gradlew` locally (e.g., in Android Studio), run `gradle wrapper --gradle-version 8.9` once from `apps/pos-android` with a real local Gradle/Android Studio install — this generates the wrapper files locally. Do not attempt to author `gradle-wrapper.jar` by hand again; use the real `gradle wrapper` command.

### Launcher icon — vector placeholder, not the real CpIPOS logo

`ic_launcher_foreground.xml` is a simple two-tone vector circle, not the actual CpIPOS brand mark, for the same reason as the wrapper jar: raster PNG launcher icons (mipmap-hdpi/xhdpi/etc.) are binary and risky to hand-author, and `minSdk 33` means the adaptive-icon XML format (`mipmap-anydpi-v26`) is sufficient on its own — no legacy raster mipmaps are needed for any supported device. Replace `ic_launcher_foreground.xml` with the real brand mark using Android Studio's Image Asset Studio (or equivalent) when someone has that tooling available; this is cosmetic only and does not block functionality.

## Native bridge — Phase 1 scope only

`MainActivity.kt` exposes `window.CpIPOSBridge` with exactly four **read-only** methods, per `docs/ANDROID-NATIVE-BRIDGE-VERSIONING.md` Phase 1:

- `getAppVersion()`
- `getBridgeVersion()`
- `getDeviceInfo()`
- `getNetworkStatus()`

Each returns a JSON string matching that doc's documented envelope: `{ ok, data, error, bridge_version, native_app_version }`. **Do not add `printReceipt`/`openCashDrawer`/order/payment methods without first reviewing the security rules in that doc** — bridge methods must never be able to write authoritative order/payment state, and must stay non-blocking for payment completion. Printing/cash drawer on Android should keep using the existing web-side paths (Bluetooth Print Agent — see `docs/POS-BLUETOOTH-PRINT-DRAWER-2026-08-06.md` — or a future dedicated native print bridge phase), not this read-only bridge.

## Behavior implemented

- Fullscreen, no system bars (edge-to-edge, `WindowInsetsControllerCompat`), re-applied on window focus regain (Android tends to let system bars creep back after app-switch).
- `android:screenOrientation="sensorLandscape"` — locks to landscape but allows both landscape rotations (left/right), matches "tablet sizes and up, landscape" requirement. `supports-screens` excludes small/normal (phone) screens, allows large/xlarge (tablet+).
- Splash screen via `androidx.core:core-splashscreen`, default system behavior (no custom keep-on-screen condition) — deliberately minimal to reduce risk of splash-theme misconfiguration in an unverified build.
- Default start URL: `https://cp-ipos-web.vercel.app/login/store` (hardcoded for Phase 1 — no remote/local URL config screen yet; that's `ANDROID-WEB-UI-AUTO-UPDATE-STRATEGY.md` Phase 3+ territory, not done here).
- Offline banner: shown/hidden both from `ConnectivityManager.NetworkCallback` (proactive) and from `WebViewClient.onReceivedError` on main-frame load failures (reactive), with a manual reload button.
- Back button: navigates WebView history back if possible, otherwise falls through to default (exit) behavior, via `OnBackPressedCallback` (not the deprecated `Activity.onBackPressed()` override).
- `usesCleartextTraffic="false"` — production URL is HTTPS only, no cleartext exception needed.

## What is explicitly NOT done (do not assume otherwise)

- No native print/cash-drawer bridge (Phase 4 of the runtime plan).
- No offline database/sync (Phase 5 / `ANDROID-OFFLINE-FIRST-FUTURE-PHASE.md`).
- No remote-configurable base URL / environment switcher.
- No device registration UX beyond the existing web `/login/devices` flow (Phase 3 of `ANDROID-MULTI-TENANT-DEVICE-REGISTRATION.md`).
- No release signing — the CI workflow builds `assembleDebug` only (Android's auto-generated debug keystore), matching the same risk level as the still-unsigned Windows Runtime `.exe`. This is fine for direct sideload install (user must enable "install unknown apps") but is not suitable for any future Play Store submission — that needs a real upload keystore, kept as a GitHub secret, out of scope for Phase 1.
- No version-consistency enforcement beyond a single `versionName` string check in CI (mirrors the spirit of the Windows workflow's 4-file version check, but there's only one version-bearing file here so far).

## CI / build

`.github/workflows/build-android-runtime.yml`, `workflow_dispatch` only (manual trigger, same as `build-windows-runtime.yml` — nothing runs automatically on push/PR). Steps: checkout → JDK 17 → Android SDK via `android-actions/setup-android@v3` → Gradle 8.9 via `gradle/actions/setup-gradle@v4` → `gradle :app:assembleDebug` → validate APK exists and is >1MB → upload workflow artifact → publish/update GitHub Release tag `android-runtime-latest` with asset `CpIPOS-Android-debug.apk` (same release-per-stable-tag pattern as `windows-runtime-latest`).

**To actually verify this Phase 1 build works**: go to the repo's Actions tab, run "Build CpIPOS Android Runtime" manually, and watch for the first real error if any. If `assembleDebug` fails, the error will point at the specific Gradle/AGP/Kotlin/dependency-version mismatch — fix that specific file, don't rewrite the whole scaffold.

## Download page

`/download/android` (page) + `/download/android/latest` (redirect route) — copy of the existing `/download/windows-runtime` pattern, redirects to the GitHub Release asset, shows a "still building" page if the release/asset isn't published yet. Not linked from anywhere in the app's own navigation, same as the Windows download page (people are expected to be given the URL directly, e.g., by support/admin).

## Verification run this round

- `pnpm --filter backoffice-web typecheck`: pass
- `pnpm --filter backoffice-web exec eslint src/app/download/android`: pass, no warnings
- `pnpm --filter backoffice-web exec vitest run --cache false`: pass (unaffected by this change — no logic touched, only new files)
- Android Kotlin/Gradle code: **not compiled, not run**. Hand-verified against known-correct, standard Android/Gradle Kotlin DSL patterns (AndroidX Activity `OnBackPressedCallback`, `androidx.core:core-splashscreen` official usage, `WindowInsetsControllerCompat` fullscreen pattern, adaptive icon XML). Treat with appropriately lower confidence than the web/`.NET` changes in this same round, which were fully build/test-verified locally.
