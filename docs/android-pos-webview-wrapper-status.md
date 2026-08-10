# Android POS WebView Wrapper Status

Last updated: 2026-08-11 02:41 ICT
Owner direction: คุณเอส / CpIPOS

## Current product decision

`CpIPOS POS - Android Tablet` is the active Android POS runtime for near-final POS-machine testing.

The current runtime direction is **Web App wrapper first**:

- Android package: `com.cpipos.pos`
- Source module: `apps/pos-android`
- Current test release: `0.2.1` / `versionCode = 4`
- Web entrypoint: `https://cp-ipos-web.vercel.app/login/store`
- Download Center route: `/download/android/latest`
- Release tag: `android-runtime-latest`
- APK asset name: `CpIPOS-Android-debug.apk`

The Android POS app must behave as a tablet/POS-machine shell around the CpIPOS Web App login and POS flow. It must not be confused with `apps/cpipos-mobile-android`, Windows POS Runtime, or IT Admin Runtime.

## Download Center rule

Only `CpIPOS POS - Android Tablet` should show as ready for download while this POS-machine testing cycle is active.

The following products must remain marked as developing until they pass separate QA:

- `CpIPOS Mobile - Android`
- `CpIPOS POS - Windows`
- `CpIPOS IT Admin Runtime`

## What changed in v0.2.1

`MainActivity.kt` is now the WebView runtime entrypoint. It loads the CpIPOS Web App login flow and keeps the user inside the Android POS app shell for normal web navigation.

The existing Kotlin/Compose/native API implementation files are intentionally retained in `apps/pos-android`. They are not the primary runtime entrypoint for this test release. Keep them available for later native device work, printer bridge work, offline/cache work, or rollback analysis.

## Current completion status

Owner-provided status: about **90% complete** for Android POS.

Do not mark Android POS as final production-complete yet. The current purpose is to create a fresh APK for POS-machine testing and finish remaining hardware/runtime tasks.

## Remaining work before final release

1. Test `CpIPOS POS - Android Tablet v0.2.1` on the real POS Android device.
2. Verify login, branch selection, device selection, active session, shift gate, POS sales flow, and receipt flow inside WebView.
3. Complete printer work. Printer status is **not complete** until real hardware is tested.
4. Decide the printer bridge architecture for Android POS:
   - WebView JavaScript bridge, or
   - local/native print agent bridge, or
   - API-driven print queue with hardware agent.
5. Validate any device policy, cookie/session behavior, fullscreen/tablet usability, and reconnect behavior.
6. Create a signed release build when ready for non-debug distribution.

## Printer note

Printer work must remain explicitly open. Existing print architecture discussions mention ticket/print-job style flows, but hardware proof is still required. Do not claim printer complete until the APK is tested against actual printer hardware on the POS machine.

## Working memory for future agents

When continuing Android POS work, use this document as the current source of truth. Treat older statements that describe Android POS as a native Compose POS client as historical implementation detail unless the owner explicitly changes the direction again.
