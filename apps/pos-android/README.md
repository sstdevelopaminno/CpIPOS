# CpIPOS POS - Android Tablet

`apps/pos-android` is the native Android tablet POS implementation.

## Product boundary

- Package: `com.cpipos.pos`
- UI/runtime: Kotlin + Jetpack Compose
- Browser shell: **none**
- PWA/browser runtime: **none**
- Business database writes: **none directly from Android**
- Server/control plane: `apps/backoffice-web` through existing `/api/auth/**` and `/api/pos/**` endpoints
- Default API base URL: `https://cp-ipos-web.vercel.app`
- Landscape-first tablet POS shell

The app reuses the same server-authoritative login, device, POS session, shift, order, payment, cookie, and idempotency pattern as `apps/cpipos-mobile-android`, but remains a separate Tablet POS product and package.

## Native operating path

- Store code -> branch -> employee -> device
- POS session bootstrap and shift open/close
- Catalog, category/search surface, cart
- Atomic server-side order creation
- Cash and transfer payment submission
- Current order history
- Member lookup/save
- Logout/session clear

## Build

Requires JDK 17 and Android SDK 34.

```bash
cd apps/pos-android
gradle :app:assembleDebug
```

GitHub Actions workflow `.github/workflows/build-android-runtime.yml` publishes the APK to the existing `android-runtime-latest` release source used by `/download/android/latest`.