# CpIPOS Mobile — Native Android

`apps/cpipos-mobile-android` is the native Android implementation of CpIPOS Mobile.

## Product boundary

- Package: `com.cpipos.mobile`
- UI/runtime: Kotlin + Jetpack Compose
- WebView: **none**
- PWA/browser runtime: **none**
- Business database writes: **none directly from Android**
- Server/control plane: `apps/backoffice-web` through the existing `/api/auth/**` and `/api/pos/**` endpoints
- Default API base URL: `https://cp-ipos-web.vercel.app`
- Minimum Android: API 26 (Android 8)
- Target Android: API 34

The app keeps HttpOnly session and pre-entry cookies in a persistent OkHttp `CookieJar`, so it uses the same server-side tenant/branch/device/session/shift security gates as the web POS. Pricing, order creation, payment, stock side effects, audit logging and Trial routing remain server-authoritative.

## Native feature set

- Store code → branch → employee code → cashier device login
- Persistent POS session cookies
- Shift status, open shift, close shift
- Native product catalog and search
- Native cart
- Atomic server-side order creation
- Cash payment and transfer settlement through the main POS payment endpoint
- Current-shift sales history
- Product list
- Member search and member create/update
- Native settings/logout
- Phone and tablet layouts using Compose

## Build locally

Requires JDK 17 and Android SDK 34.

```bash
cd apps/cpipos-mobile-android
gradle :app:assembleDebug
```

APK:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## GitHub release

`.github/workflows/build-cpipos-mobile-android.yml` builds this app independently of Vercel.

On a push to the production baseline branch it publishes:

- tag: `cpipos-mobile-latest`
- asset: `CpIPOS-Mobile.apk`

The main web project exposes the stable download endpoint:

```text
/download/mobile
/download/mobile/latest
```

## Legacy mobile web app

`apps/pos-mobile-web` remains in the repository temporarily as migration/reference code. It is no longer the target runtime architecture for CpIPOS Mobile. Do not add new native-only functionality there.
