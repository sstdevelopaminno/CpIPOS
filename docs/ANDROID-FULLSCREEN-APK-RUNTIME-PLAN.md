# Android Fullscreen APK Runtime Plan

Date: 2026-08-02
Status: Documentation only. No production code changes.

## Purpose

Design the CpIPOS Android 13+ runtime as a fullscreen APK shell that loads the existing CpIPOS web POS UI. The Android app must not recreate the UI in native Android, Flutter, React Native, or any other native UI stack. The current web app remains the source of truth for POS screens, login, sales, payment, receipt preview, and backoffice behavior.

This plan intentionally separates:

- web UI updates, which should appear online without publishing a new APK
- native Android runtime features, which require APK changes only when native capability changes

## Current CpIPOS Behavior To Preserve

CpIPOS currently uses the `apps/backoffice-web` Next.js application as the main runtime for POS and backoffice operations. The active login flow is:

```text
/login/store -> /login/branches|employee -> /login/devices -> /preview/pos
```

The following behavior must remain unchanged:

- existing web POS UI remains the main UI
- existing POS preview route remains `/preview/pos`
- existing store-code login and branch/device flow remains server-driven
- existing Supabase/RLS/server-side scope validation remains authoritative
- existing tenant, branch, user, role, feature gate, and shift gate rules remain server-side
- existing payment behavior must not be blocked by printing or native bridge failures
- existing print adapter direction remains valid: web does not rely on Chrome Web Serial as the default hardware path

## Proposed Architecture

```text
Android APK Shell
  - Android 13+
  - fullscreen WebView runtime
  - app splash screen
  - network status detection
  - native bridge namespace/version
  - remote config for CpIPOS web URL

Existing CpIPOS Web UI
  - loaded from production/staging CpIPOS URL
  - remains the source of truth for UI and route behavior
  - updates automatically when online

Native Bridge Layer
  - optional and versioned
  - used only for Android device/hardware capabilities
  - not required for the first documentation-only phase
```

The first APK should behave like a controlled POS browser shell, not like a new POS implementation.

Recommended runtime direction:

- WebView-based shell or Capacitor-based WebView shell
- fullscreen display with no browser chrome
- remote configurable base URL, defaulting to CpIPOS production URL
- no kiosk mode, no lock task mode, no MDM, no device owner mode
- bridge methods exposed under a stable `CpIPOSBridge` namespace only when implemented

## Data Flow

### First Launch

```text
APK opens
-> reads remote/local app URL config
-> loads CpIPOS login URL
-> user enters store code
-> server resolves tenant/branch policy
-> user selects branch when required
-> user verifies employee/owner/manager
-> user selects or registers device
-> server creates POS session
-> WebView navigates to /preview/pos
```

### Normal Online Use

```text
Android APK WebView
-> CpIPOS web POS route
-> existing API routes
-> server validates POS session, tenant, branch, user, role, device, shift
-> web UI renders current online version
```

### Native Bridge Use In Later Phases

```text
Web UI
-> window.CpIPOSBridge.<method>()
-> Android native bridge
-> Android hardware/API layer
-> result returned to web UI
```

Native bridge failure must not corrupt server-side order/payment state.

## Security Rules

- Do not expose Supabase service role key in APK.
- Do not store admin secrets in APK.
- Do not hardcode tenant IDs, branch IDs, owner IDs, or device codes in the APK.
- Do not trust local tenant, branch, or device values without server validation.
- Keep server-side session creation and scope validation authoritative.
- Device registration must bind Android terminals to validated tenant, branch, and device record server-side.
- Store only safe session/device metadata in the APK.
- Do not allow cross-tenant cache, sync, or bridge calls.
- Do not let native bridge success/failure override payment truth.
- Do not use lock-task/kiosk features in this phase.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| WebView cache shows stale POS UI | Operators see old UI after web deploy | Use network-first loading for app and POS routes; fallback to cache only offline |
| Native bridge contract changes break web | Printing/device APIs fail | Version bridge methods and gate by bridge version |
| Android app stores unsafe tenant scope | Cross-tenant data leak | Store only server-issued safe session/device info; always validate server-side |
| Offline mode corrupts data | Duplicate orders/payments | Keep offline as a future phase with idempotency keys and sync queue |
| Hardware support grows too quickly | Testing becomes unstable | Start with shell only; add native bridge in controlled phases |
| Web app becomes dependent on APK-only feature | Browser/PWA behavior breaks | Keep web behavior as the source of truth and retain web-compatible fallbacks |

## Implementation Phases

### Phase 0: Documentation And Review

- Create architecture documents only.
- Do not create Android project files yet.
- Do not change web app routes, APIs, database, or service worker behavior.
- Confirm target devices and OS versions.

### Phase 1: Minimal Android WebView Shell

- Create Android 13+ APK shell.
- Load CpIPOS production/staging URL.
- Use fullscreen display without address bar.
- Add splash screen and basic network banner.
- Add app version display for support.
- No hardware bridge yet.

### Phase 2: Web Runtime Hardening

- Add network-first loading strategy for CpIPOS routes.
- Prevent stale service worker/app shell state.
- Add clear cache/reload support inside APK settings.
- Add bridge availability detection.

### Phase 3: Native Bridge Foundation

- Add versioned `CpIPOSBridge.getAppVersion()`.
- Add `CpIPOSBridge.getBridgeVersion()`.
- Add `CpIPOSBridge.getDeviceInfo()`.
- Add `CpIPOSBridge.getNetworkStatus()`.
- Do not add printing until bridge contract is reviewed.

### Phase 4: Android Hardware Bridge

- Add Android-specific receipt/kitchen print methods.
- Add cash drawer method only for supported hardware paths.
- Add printer status method where supported.
- Keep printing non-blocking from payment completion.

### Phase 5: Offline Future Phase

- Add local database design only after online runtime is stable.
- Use local IDs and idempotency keys.
- Add sync queue and retry semantics.
- Enforce tenant/branch boundaries during sync.

## Acceptance Checklist

- [ ] Existing CpIPOS web UI remains the main UI.
- [ ] No native rewrite of POS UI is introduced.
- [ ] Android shell opens CpIPOS fullscreen on Android 13+.
- [ ] No browser address bar is visible.
- [ ] No kiosk, lock task, MDM, device owner, or device lock behavior is added.
- [ ] Existing `/login/store -> branch/employee -> devices -> /preview/pos` flow remains unchanged.
- [ ] Web UI updates appear automatically when online.
- [ ] APK updates are required only for native runtime/bridge/offline changes.
- [ ] Tenant/branch/device validation remains server authoritative.
- [ ] No Supabase service role key or admin secret is included in the APK.
- [ ] Printing or cash drawer failure cannot block payment completion.
- [ ] Existing web app, backoffice routes, POS preview routes, API routes, and Supabase logic remain untouched during documentation phase.
