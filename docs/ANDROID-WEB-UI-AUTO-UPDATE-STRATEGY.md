# Android Web UI Auto Update Strategy

Date: 2026-08-02
Status: Documentation only. No production code changes.

## Purpose

Define how the CpIPOS Android 13+ fullscreen APK shell should display the latest CpIPOS web UI automatically when online, without requiring a new APK release for normal POS UI changes.

The Android APK must behave as a native shell around the existing web runtime. The web deployment remains the source of truth for UI updates.

## Current CpIPOS Behavior To Preserve

CpIPOS currently deploys the POS UI through the web app. Login, POS preview, sales flow, receipts, settings, and backoffice routes live in `apps/backoffice-web`.

The Android runtime must preserve:

- the existing web UI as the source of truth
- the existing production/staging web deployment model
- the existing route contract, including `/login/store` and `/preview/pos`
- service-role/server-only boundaries
- server-side tenant, branch, session, permission, and device validation
- web/PWA behavior for browser users

## Proposed Architecture

```text
Android APK Shell
  -> loads configured CpIPOS web URL
  -> applies WebView settings for fullscreen POS runtime
  -> detects online/offline state
  -> uses network-first behavior for app/POS routes
  -> falls back to cached UI only when offline

CpIPOS Web Deployment
  -> owns UI, route, API, and service worker behavior
  -> exposes web_ui_version/build metadata where available
```

Recommended URL model:

```text
production_url = https://cp-ipos-web.vercel.app
login_url      = {production_url}/login/store
pos_url        = {production_url}/preview/pos
```

The APK should support remote config in a later phase so staging/production URL can be changed without rebuilding the app, but no admin secret may be embedded in the APK.

## Data Flow

### Online Launch

```text
APK starts
-> reads app URL config
-> checks network status
-> loads /login/store or last safe route using network-first
-> WebView receives current web deployment
-> user follows existing login/POS flow
```

### Web UI Deployment Update

```text
Developer deploys new CpIPOS web UI
-> Vercel serves updated web assets
-> Android APK launches or reloads online
-> WebView fetches latest app route/assets
-> updated UI appears without APK update
```

### Offline Launch

```text
APK starts without internet
-> show offline banner
-> use cached shell only if previously available and safe
-> avoid performing server-trust actions without server validation
-> offline order/database behavior remains future phase only
```

## Cache And Service Worker Strategy

The Android shell should avoid stale POS UI problems by using a network-first strategy for critical routes:

- `/login/*`
- `/preview/pos*`
- `/api/auth/*`
- `/api/pos/*`
- build/version metadata route

Expected behavior:

- online: prefer network and refresh stale assets
- offline: use safe cached UI only for display/fallback
- after login/session change: avoid stale cached auth/session responses
- after app version mismatch: reload the WebView and clear stale cache if needed

Recommended Android controls for later implementation:

- support a manual `Clear Web Cache And Reload` support action
- expose app version and loaded web URL in a support screen
- log web UI version if provided by the web app
- avoid forcing cache clear on every startup unless needed, because it can slow field use

## Security Rules

- Do not use cached tenant/branch/session values as trusted scope.
- Do not let stale cached API responses authenticate users.
- Do not store service-role or admin secrets in WebView local storage or APK config.
- Do not bypass existing server-side session validation.
- Do not allow offline UI to create authoritative orders/payments until offline engine is explicitly implemented.
- Clear or isolate WebView data when switching tenants only through approved logout/device reset behavior.
- Never rely on client-provided tenant, branch, or device values for permission decisions.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Old service worker sends stale UI | APK appears not updated | Network-first for critical routes; build/version check; support cache clear |
| WebView caches login/session response | Login loop or wrong state | Bypass cache for auth/POS APIs and login pre-entry routes |
| Clearing all cache too often | Slow startup and forced login | Version-aware cache clear only when needed |
| Offline screen appears usable for sales too early | Unsynced/invalid sales | Mark offline-first order mode as future phase only |
| Remote config points to wrong URL | Users see wrong environment | Validate URL allowlist and show environment label in support/debug panel |

## Implementation Phases

### Phase 0: Documentation

- Document update strategy.
- Do not change existing web app behavior.
- Do not create Android code yet.

### Phase 1: Minimal Network-First WebView

- Configure WebView to load CpIPOS production/staging URL.
- Use online network-first loading for top-level routes.
- Add offline banner.
- Add reload button.

### Phase 2: Version Awareness

- Add web UI version detection where available.
- Add native app version and bridge version display.
- Trigger cache refresh when web UI version changes and WebView is stale.

### Phase 3: Support Controls

- Add clear WebView cache action.
- Add environment URL display.
- Add diagnostics export without secrets.

### Phase 4: Offline Fallback

- Allow cached UI display only.
- Do not allow offline order sync until offline-first phase is implemented.

## Acceptance Checklist

- [ ] Web UI updates do not require APK update.
- [ ] APK loads the configured CpIPOS web URL online.
- [ ] Login and POS routes use current web deployment when online.
- [ ] Stale service worker/cache does not trap users on old login/POS UI.
- [ ] Offline banner appears when network is unavailable.
- [ ] Cached UI is only a fallback and not a trusted source of tenant/branch/session truth.
- [ ] Existing web/PWA behavior remains unchanged.
- [ ] No production code is changed during documentation phase.
