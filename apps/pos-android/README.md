# CpIPOS POS - Android Tablet

`apps/pos-android` is the native Android tablet POS runtime shell.

## Product boundary

- Package: `com.cpipos.pos`
- UI/runtime: thin Android WebView wrapper over the authoritative CpIPOS Web App
- Start URL: `https://cp-ipos-web.vercel.app/login/store`
- Business database writes: none directly from Android
- Server/control plane: `apps/backoffice-web` through authenticated Web App/API session cookies
- Native responsibilities: fullscreen tablet shell, trusted-host WebView session, CpIPOSBridge, MDM heartbeat/actions, connectivity recovery, diagnostics, and future hardware capabilities
- Not included: duplicate native POS screens, Compose UI, native ViewModel state, direct OkHttp API stack, or native coroutine polling loops

The Web App remains the source of truth for POS UI, responsive layout, permissions, session behavior, orders, payments, package gates, and tenant/data-home routing. Android must not inject CSS, hide/show Web buttons, or fork business rules.

## Runtime behavior

- Loads only the trusted CpIPOS production host in WebView
- Keeps first-party cookies, JavaScript, and DOM storage enabled for the Web App session
- Blocks mixed content and disables Android/WebView forced darkening so Web CSS colors remain authoritative
- Uses a single 5-minute MDM heartbeat scheduler while active on the trusted host
- Uses a 20-second page-load watchdog, offline banner, reload control, and bounded renderer recovery

## Build

Requires JDK 17 and Android SDK 34.

```bash
cd apps/pos-android
gradle :app:assembleDebug
```

GitHub Actions workflow `.github/workflows/build-android-runtime.yml` can build and upload an APK artifact from `workflow_dispatch`. It publishes `android-runtime-latest` only when `publish_release=true`.
