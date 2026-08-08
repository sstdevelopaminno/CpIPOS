# CpIPOS Mobile Native Android — 2026-08-08

Status: implementation baseline.

## Decision

CpIPOS Mobile is now a native Android product in the single `sstdevelopaminno/CpIPOS` repository.

The target runtime is:

- Kotlin
- Jetpack Compose
- OkHttp
- Android APK
- no WebView
- no PWA runtime
- no separate CpIPOS Mobile hosting project

`apps/pos-android` remains the separate CpIPOS Android POS tablet runtime. `apps/windows-runtime-native` remains the Windows POS Runtime. This change does not merge or remove either product.

## Source of truth

Native mobile UI:
- `apps/cpipos-mobile-android`

Server/control plane:
- `apps/backoffice-web`
- `/api/auth/**`
- `/api/pos/**`

Legacy mobile web/PWA:
- `apps/pos-mobile-web`
- retained temporarily only as migration/reference source

## Security and data boundary

The Android app does not use Supabase service-role credentials and does not perform authoritative business writes directly against Supabase.

The app calls the main CpIPOS server APIs. The server remains responsible for:

- tenant / branch resolution
- employee permission checks
- registered device rules
- POS session creation
- shift binding
- package/feature gates
- server-side product pricing
- atomic order creation
- payment transaction
- stock side effects
- audit logging
- CpiPOS-001 / CpiPOS-002 Trial data routing

This preserves the production baseline instead of recreating transaction logic inside the APK.

## Native app scope in v1.0.0

- Store code login
- Branch selection / auto-skip
- Employee code verification
- Device listing and selection
- Persistent HttpOnly-compatible server cookies using OkHttp CookieJar
- Shift current/open/close
- Product load/search
- Native cart
- Atomic order create
- Cash payment
- Bank-transfer settlement using the current server QR-only transfer path
- Current-shift sales list
- Product list
- Member search and save
- Native settings and logout

## Distribution

Workflow:
- `.github/workflows/build-cpipos-mobile-android.yml`

Release:
- tag `cpipos-mobile-latest`
- asset `CpIPOS-Mobile.apk`

Web download:
- `/download/mobile`
- `/download/mobile/latest`

The APK build runs on GitHub Actions and therefore does not consume a Vercel mobile deployment.

## Release signing

The initial pipeline mirrors the repository's existing Android POS pattern and builds a debug-signed APK for sideload distribution. Before managed fleet/in-place production upgrades are enabled, add a stable private release keystore through GitHub Actions Secrets and switch the workflow to a signed release APK/AAB. Never commit a production signing key to this repository.
