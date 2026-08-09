# CpIPOS Web + Android Runtime Handoff - 2026-08-10

## 1. Current Architecture

CpIPOS Web App is the authoritative customer UI and business frontend. Android Tablet 0.2.2 is a thin WebView/native capability shell for MDM, native bridge, diagnostics, and future hardware/device integrations. Windows runtime work is postponed and is not part of this checkpoint.

Production Web URL: `https://cp-ipos-web.vercel.app`

Android start URL: `https://cp-ipos-web.vercel.app/login/store`

## 2. Exact Source Checkpoints

- Web source: `fae73672cd290711ab0889846467af21879fe847`
- Android source: `0922c8c320ca986a173b72a21ef48921631e6eef`
- Integration branch: `agent/web-android-0.2.2-integration`
- Use the exact Android checkpoint above. Do not integrate housekeeping/no-op commits that followed it.

## 3. Web UI Improvements

- Login/pre-entry centering.
- Tablet sidebar/menu accessibility.
- CSS/button/color parity with the Web App reference UI.
- Runtime update awareness through `/api/runtime/version` and the watcher component.
- Active sale/payment route protected from automatic reload.

## 4. Web Scrolling/Responsive Rules

- Pre-entry pages use natural viewport centering and vertical scroll when content exceeds the screen.
- POS sales owns its internal scroll on `/preview/pos`.
- POS management/subpages use explicit content scroll ownership.
- Wide tables must have horizontal overflow wrappers.
- Modals must fit within `100dvh` and scroll internally when content is taller than the viewport.

## 5. Runtime Version/Update Mechanism

`/api/runtime/version` returns the current deployment version without database access and with no-store caching headers. The Web runtime update watcher checks on focus, visibility changes, and a bounded interval. Safe pre-entry pages may auto refresh. Active sale/payment UI must not auto reload; it shows a manual update action instead.

## 6. Android 0.2.2 Architecture

- `versionName`: `0.2.2`
- `versionCode`: `5`
- Production entry: Android WebView loading `https://cp-ipos-web.vercel.app/login/store`
- Release tag when authorized: `android-runtime-latest`
- Release asset when authorized: `CpIPOS-Android-debug.apk`

Android owns the runtime wrapper, authenticated WebView session, MDM heartbeat/commands, native bridge, diagnostics, and future hardware/device services.

## 7. Android Stability Improvements

- Removed duplicate native Compose POS stack.
- Removed obsolete `AppViewModel`, API client, native models, and persistent cookie jar code.
- Disabled forced darkening.
- Added renderer crash recovery and unresponsive detection.
- Cleaned lifecycle pause/resume/stop handling.
- Kept one MDM heartbeat scheduler.
- Preserved first-party session cookies.
- Retained 20s load watchdog and offline/reload handling.

## 8. MDM/Native Bridge Responsibilities

MDM remains responsible for enrollment/device identity, heartbeat, diagnostics, future update commands, and device management telemetry. Native bridge remains responsible for exposing approved native runtime/device information and future hardware capabilities to the Web App.

## 9. What Android MUST NOT Implement

Android must not implement duplicate native POS business UI, transaction rules, tenant/branch authorization, package/subscription enforcement, pricing/totals authority, Trial/Primary routing decisions, or data_home fallback logic. Those belong to Web/backend/database authority.

## 10. Build Commands

From repo root:

```powershell
cmd /c pnpm --filter backoffice-web exec tsc -p tsconfig.json --noEmit --pretty false
cmd /c pnpm --filter backoffice-web test
```

From `apps/pos-android`:

```powershell
.\gradlew.bat :app:assembleDebug --no-daemon --console=plain --stacktrace
.\gradlew.bat :app:lintDebug --no-daemon --console=plain
```

## 11. Validation Commands

```powershell
git diff --check
git status --short
git diff --stat
rg -n "WebRuntimeUpdateWatcher|/api/runtime/version|versionName|versionCode|cp-ipos-web.vercel.app/login/store|AndroidBridge|MDM|Compose" apps docs README.md context.md
```

## 12. Release Workflow

No APK release was performed in this checkpoint. When explicitly authorized, validate the Android workflow, publish the release tag `android-runtime-latest`, and attach `CpIPOS-Android-debug.apk`. Do not publish from an unverified or dirty worktree.

## 13. Production Verification

- Verify production Web deploy serves `https://cp-ipos-web.vercel.app`.
- Verify `/login/store`, branch selection, employee code, device selection, and `/preview/pos` on production.
- Verify `/api/runtime/version` returns no-store headers and a version value.
- Verify Android WebView opens `https://cp-ipos-web.vercel.app/login/store` and retains session cookies.
- Verify active transactions are not auto refreshed during runtime update detection.

## 14. Known Safe Boundaries

- Supabase/live database not touched.
- DB migrations none.
- Package/subscription unchanged.
- `tenant_data_lifecycle.data_home` unchanged.
- Windows not touched.
- No production merge.
- No APK release.
- No secrets added.

## 15. Pending Work

- Integration QA.
- Production merge/deploy.
- Production Web QA.
- Android 0.2.2 workflow validation.
- Android 0.2.2 release.
- Physical Tablet QA.
- Old temporary branch cleanup only after Production and Android 0.2.2 physical QA pass.

## 16. Next Priority

1. MDM/admin device management.
2. Kitchen configuration/runtime.
3. Printer/hardware integration.