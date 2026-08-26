# Codex Handoff — FF0001 Shift Clock / Unclickable Toolbar Hotfix

Date: 2026-08-26
Production branch: `agent-docs-preflight-schema-drift`
Production hotfix commit: `4430d8ba0e96fa4718570dfaea58c9b33b163626`
Production Vercel deployment: `dpl_BSXgxsMLK3Usi9bJ56HAcw3UN4Hz`

## Read first

1. Re-fetch the current production HEAD before editing anything.
2. Read `context.md`, `README.md`, the POS auth/session docs, and existing shift lifecycle docs.
3. Do not broad-refactor POS sales, payment, table QR, printing, stock, MDM, or Android runtime as part of this follow-up.
4. Preserve multi-tenant / branch / device / role scoping.
5. The customer-facing incident is FF0001, but permanent code must remain safe for all tenants.

## Incident reproduced from customer video

Customer video showed:
- POS gate displayed `กรุณาเปิดกะก่อนทุกครั้ง`.
- Persistent top toolbar was visible but taps/clicks did not work.
- User opened shift with opening cash 200.00.
- UI displayed `กำลังพาเข้าหน้าขาย...`.
- Newly opened shift was closed immediately and the user was redirected out of POS.

Production logs matching the video showed repeated sequences such as:
- `POST /api/pos/shifts/open` -> 201
- about 1-2 seconds later `POST /api/pos/shifts/close` -> 200
- then `POST /api/auth/session/logout` -> 200

Supabase confirmed the newly opened shifts had:
- `opening_cash = 200.00`
- `closing_cash = null`
- `close_reason = self_close`
- `system_auto_closed = false`
- close occurred about 1.5 seconds after open

That signature matches the client Shift Cycle Guard calling quick-close with no cash value, not a DB trigger and not a user manual close.

## Root cause

FF0001 Android runtime telemetry showed a client/device clock approximately +24 hours ahead of Vercel/Supabase server time.

`apps/backoffice-web/src/components/pos/pos-shift-cycle-guard-core.tsx` calculates the phase with:
- `resolveShiftCycle(activeShift.opened_at)`
- `resolveShiftGuardPhase(nextCycle)`

`resolveShiftGuardPhase()` defaults `now` to client `new Date()` / device time. With the Android clock one day ahead, a shift opened seconds ago appeared past its auto-close deadline. The guard then executed:
- `closeShift(null, "", true)`
- followed by `logoutToBranchSelection()`

This was the immediate open -> close -> logout loop.

The top-toolbar issue was separate but visible in the same video. `PosEntryGate` renders a full-screen `.pos-entry-gate` / `.pos-entry-gate__overlay` while the no-active-shift dialog is shown. The persistent toolbar stays visible behind it but pointer input is intercepted by the gate layer.

## Emergency production hotfix already deployed

File changed:
`apps/backoffice-web/src/components/pos/pos-shift-cycle-guard.tsx`

Hotfix behavior:
1. Before mounting the destructive Shift Cycle Guard core, fetch `/api/pos/session/current` and read the same-origin HTTP `Date` header.
2. Compare client `Date.now()` with server response time.
3. If absolute skew is greater than 5 minutes, or server time cannot be trusted, DO NOT mount the automatic Shift Cycle Guard.
4. Re-check once per minute.
5. This is fail-safe: an untrusted clock may temporarily lose automatic overdue-shift prompting, but it must never auto-close a valid new shift.
6. Inject a narrowly-scoped pointer-events override for the no-shift `role="dialog"` entry gate so clicks can pass to the persistent toolbar, while the gate dialog itself remains interactive and sales remain unavailable until a shift exists.

Preview verification before production promotion:
- Next production compile: PASS
- TypeScript: PASS
- Static generation: PASS 213/213
- Preview deployment: READY
- Same commit then fast-forwarded to production
- Production deployment: READY
- `/api/system/build-info` confirmed commit `4430d8ba0e96fa4718570dfaea58c9b33b163626`

## Required permanent follow-up

The wrapper hotfix intentionally minimizes blast radius. Replace it later with a server-time-based design.

### Preferred permanent design

1. Add an explicit authoritative server timestamp to `/api/pos/session/current`, for example `server_now` ISO UTC.
2. In `pos-shift-cycle-guard-core.tsx`, maintain a server/client offset from the session response.
3. Pass authoritative server-derived `now` into `resolveShiftGuardPhase(cycle, now)`.
4. Do not allow automatic close if authoritative server time is unavailable or stale.
5. Reset `autoCloseRunRef` correctly when the active shift id changes.
6. Add telemetry when client/server skew exceeds a threshold; include device code and skew magnitude but no sensitive data.
7. Keep the current >5 minute fail-safe until the server-time implementation is proven in Preview and on FF0001.

### Android / MDM follow-up

Investigate why FF0001-POS-01 Android time telemetry was +24h. Do not fix this by rewriting business timestamps in Supabase.

Check:
- Android automatic date/time setting
- timezone and NTP/network time source
- runtime clock source used for `at_ms` / updater telemetry
- whether native code uses wall-clock vs elapsed realtime incorrectly

Correcting the device clock is desirable, but POS business safety must not depend on a perfectly configured client clock.

### Toolbar follow-up

The emergency CSS uses `:has()` to scope pointer pass-through to the no-shift dialog state. For the permanent implementation, prefer an explicit class such as `pos-entry-gate--shift-required` in `pos-entry-gate.tsx`, then:
- make only that state pointer-transparent outside its panel
- keep loading, permission-denied, expired-session, and device-maintenance gates modal/blocking
- keep the no-shift dialog buttons interactive
- keep sales content inaccessible without an active shift

## Regression tests required

At minimum add tests/contracts for:

1. Fresh shift + client clock +24h:
   - opening shift succeeds
   - no automatic close request occurs
   - session remains active and bound to the new shift

2. Fresh shift + client clock -24h:
   - no destructive automatic action based only on client time

3. Normal clock:
   - existing overdue/urgent behavior remains available

4. No active shift:
   - sales entry remains blocked
   - Open/Close Shift button works
   - persistent allowed toolbar actions remain clickable

5. Close shift manually:
   - explicit close still closes exactly once
   - open-bill blockers still work
   - no duplicate logout/session loop

6. Continue shift:
   - close old shift + open next shift remains deterministic

7. FF0001 E2E:
   - login as current owner
   - select FF0001-POS-01
   - open shift with 200.00
   - stay in POS for at least 60 seconds
   - verify DB shift remains `open`
   - verify no `/api/pos/shifts/close` occurs unless user explicitly closes
   - verify toolbar actions are clickable while no shift exists

## Do not regress the FF0001 owner repair

FF0001 previously had zero owners. The existing administrative account was emergency-promoted from manager to owner in production. A separate handoff documents the permanent first-owner bootstrap issue. Do not overwrite or silently downgrade that role.
