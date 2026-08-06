# POS Stability Fixes 2026-08-06

Branch: `agent/revert-raster-print-to-stable` (PR #31 into `agent-docs-preflight-schema-drift`)

## Scope

After reverting PR #30 (ESC/POS raster receipt printing) back to the prior stable text/HTML print path, this round investigated and fixed live UI stability/bottleneck issues across both the web app and the Windows runtime.

## Web (`apps/backoffice-web`)

- `GET /api/pos/shifts/current` now wraps its Supabase query (and the legacy no-`device_code` fallback query) in the same `withQueryTimeout` pattern already used by `session/current`. On timeout it returns `503` with `error.code: "shifts_current_lookup_degraded"` and header `x-pos-shifts-current-fallback: 1`, instead of risking an unbounded hang.
- Browser Print Agent (`src/components/printing/browser-print-agent.tsx`) no longer polls at a fixed 4s interval regardless of outcome:
  - On repeated claim/network failures it now backs off exponentially (`POLL_MS * 2^errorStreak`, capped at `MAX_ERROR_BACKOFF_MS` = 60s), reset to normal on the next success.
  - While `document.visibilityState === "hidden"` it skips the network call and only re-checks every `HIDDEN_POLL_MS` (15s); a `visibilitychange` listener triggers an immediate tick when the tab becomes visible again.
- `docs/pos-stress-checklist.md` corrected: default `NEXT_PUBLIC_POS_MONITOR_POLL_MS` is `30000` (clamped `15000`-`120000`), not `5000` as previously documented.

## Windows runtime (`apps/windows-runtime-native/Cpipos.WindowsRuntime`)

- **Version consistency**: the raster-print revert left `Cpipos.WindowsRuntime.csproj` and `LocalPrintBridge.cs` at `0.1.6` while `MainForm.cs`, the Inno Setup installer, and `.github/workflows/build-windows-runtime.yml` were still at `0.1.5`. All four now read `0.1.6`. Confirmed this matches the exact string patterns the workflow's "Validate Windows runtime version consistency" step checks for.
- **Print/drawer lock race**: `OpenPrinterKickDrawerAsync` (the default cash-drawer mode, which writes raw ESC/POS bytes directly to the receipt printer) now also acquires `_printLock` before calling `RawPrinterWriter.SendBytes`, in addition to the `_drawerLock` it already held. Previously a rapid print + drawer-open (e.g. double-tap payment) could interleave raw bytes with an in-flight GDI-spooled print job on the same physical printer. Lock order is always `_drawerLock` → `_printLock`; no code path acquires them in the reverse order, so this does not introduce a deadlock risk.
- **Runaway pagination guard**: the multi-page text print loop in `PrintTextAsync` now aborts with `InvalidOperationException` if it exceeds `MaxTextPrintPages` (100), instead of relying solely on the 45s job timeout to bound a malformed payload.
- **`HttpClient` reuse**: `OpenNetworkDrawerControllerAsync` (the `external-network-controller` HTTP mode) now reuses a single static `DrawerHttpClient` instead of allocating a new `HttpClient` per drawer-open call, avoiding socket exhaustion risk on stores that use this mode.
- Fixed the pre-existing `CS8602` nullable-reference warning on `eventArgs.Graphics` in the print pagination loop (now null-checked with a clear exception instead of an unchecked dereference).

## Verification run this round

- `pnpm --filter backoffice-web typecheck`: pass
- `pnpm --filter backoffice-web exec vitest run --cache false`: 78/78 tests pass (31 files)
- `pnpm --filter backoffice-web exec eslint ...`: pass, no warnings
- `pnpm schema:drift`: pass
- `dotnet build Cpipos.WindowsRuntime.csproj -c Release`: build succeeded, 0 errors; only the pre-existing unrelated `WindowsBase` version-conflict `MSB3277` warning remains (nuget package reference conflict, not app code)

## Known remaining issue (not fixed this round, flagged for a dedicated pass)

`apps/backoffice-web/src/components/pos/pos-sales-module.tsx` is a single ~9,684-line component with no `React.memo`/component-level memo boundaries. Any state update (search keystroke, cart quantity change, one of the ~15 polling timers firing) re-renders the entire POS screen tree. This is the top remaining re-render/jank risk on low-end Windows/tablet hardware with a large product catalog. Splitting this file into memoized sub-components (product grid, cart panel, modals) is a substantial refactor and was deliberately left out of this stability round — treat as a separate, dedicated task with its own regression testing.
