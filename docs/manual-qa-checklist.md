# Manual QA Checklist (Final Hardening)

Use this checklist before go-live. Record pass/fail, tester, timestamp, tenant, and branch for every scenario.

## Login Context + Device Guard
- [ ] Valid store code returns tenant + active branches.
- [ ] Invalid store code returns safe not-found response.
- [ ] Inactive tenant is blocked.
- [ ] Inactive branch is blocked.
- [ ] Missing branch login policy is blocked.
- [ ] Missing device (when required) is blocked.
- [ ] Wrong-branch device is blocked.
- [ ] Inactive/unapproved device is blocked.
- [ ] Expired `ctx` is rejected.
- [ ] Consumed `ctx` replay is rejected.

## Authentication Methods
- [ ] QR login success path works.
- [ ] QR token missing returns `qr_token_missing`.
- [ ] QR token invalid returns `qr_token_invalid`.
- [ ] QR token expired returns `qr_token_expired`.
- [ ] QR token used/replay returns `qr_token_used`.
- [ ] QR token revoked returns `qr_token_revoked`.
- [ ] QR token scope mismatch returns `qr_token_scope_mismatch`.
- [ ] PIN login success path works.
- [ ] Staff-card login success path works.
- [ ] Staff card missing returns `staff_card_missing`.
- [ ] Staff card invalid returns `staff_card_invalid`.
- [ ] Staff card inactive returns `staff_card_inactive`.
- [ ] Staff card lost returns `staff_card_lost`.
- [ ] Staff card revoked returns `staff_card_revoked`.
- [ ] Staff card scope mismatch returns `staff_card_scope_mismatch`.
- [ ] Invalid PIN fails safely (no internal leak).
- [ ] User without branch role is rejected.
- [ ] Staff login succeeds only within assigned branch scope.
- [ ] Manager login succeeds with manager permissions.
- [ ] Owner login succeeds with owner permissions.
- [ ] Repeated failed login attempts trigger rate limiting (429).
- [ ] Auth verify endpoints fail closed when centralized rate-limit backend is unavailable in production mode.

## Session + Shift + Sales
- [ ] POS session is created on successful login.
- [ ] User cannot enter sales without active shift.
- [ ] Shift open works.
- [ ] Shift join works for existing open shift in same scope.
- [ ] Order creation works with active shift.
- [ ] Payment completion works and marks order paid.
- [ ] Receipt preview is shown after payment.

## POS Preview Loading QA
- [ ] Open `/preview/pos` without POS session.
- [ ] Expected: page does not hang forever at `Loading POS session...`.
- [ ] Expected: page shows `Login required` or `No active POS session found` state.
- [ ] Force `/api/pos/perf` write failure and confirm UI is not blocked.
- [ ] Apply latest migrations and confirm `audit_logs.target_user_id` exists.
- [ ] Confirm `/api/pos/session/current` returns expected `401 missing_pos_session` or `200`.
- [ ] Confirm `/api/pos/shifts/current` returns expected non-500 response for normal missing-shift scenarios.

## Attendance Visibility
- [ ] Owner sees branch attendance summary and detail list.
- [ ] Manager sees branch attendance summary and detail list.
- [ ] Staff sees only own attendance (no unauthorized staff list).
- [ ] Manual attendance status update requires `attendance:manage`.

## Feature Gate + Quota
- [ ] Disabled feature returns API rejection (not UI-only hide).
- [ ] Branch quota exceeded blocks new branch creation.
- [ ] Device quota exceeded blocks new/approved device.
- [ ] User quota exceeded blocks new user assignment.

## Mobile QR Phase 1 (Activation + Enrollment)
- [ ] Create activation token via `POST /api/it-admin/admin/activation-tokens`.
- [ ] Claim activation token successfully via `POST /api/mobile/activation/claim`.
- [ ] Claim expired token is rejected (`activation_token_expired`).
- [ ] Claim consumed token is rejected (`activation_token_consumed`).
- [ ] Claim revoked token is rejected (`activation_token_revoked`).
- [ ] Unregistered mobile cannot start mobile login (`POST /api/mobile/login/start` blocked).
- [ ] Enrolled/trusted mobile can start mobile login and receives opaque `ctx`.
- [ ] Wrong tenant/branch scope on claimed/enrolled device is rejected.
- [ ] Mobile login context replay is rejected after successful verify.
- [ ] Mobile login verify does not trust client `tenant_id`/`branch_id`.
- [ ] Slip scan endpoints are not mixed into mobile login verify flow (separate/not implemented in this phase).

## Audit and Security Validation
- [ ] Login success is logged (`login_attempts` + `audit_logs`).
- [ ] Login failure is logged (`login_attempts`, with failure reason).
- [ ] Replay attempt is logged.
- [ ] Device mismatch is logged.
- [ ] Session create/revoke is logged.
- [ ] Shift open/close is logged.
- [ ] Order create/payment is logged.
- [ ] Attendance changes are logged.
- [ ] Role/policy/feature changes are logged.
- [ ] Public API errors do not expose raw DB/internal details.


## Web + Android Tablet Runtime QA
- [ ] Login card is centered on desktop/tablet and remains reachable on small screens.
- [ ] Branch selection screen renders and scrolls correctly.
- [ ] Employee code screen renders and scrolls correctly.
- [ ] Device selection screen renders and scrolls correctly.
- [ ] POS sidebar is visible/usable on tablet portrait and landscape.
- [ ] Active menu colors match the Web App reference UI.
- [ ] Submenu and button colors match the Web App reference UI.
- [ ] Shift page vertical scrolling works without page lock issues.
- [ ] Sales table supports horizontal and vertical scrolling.
- [ ] Modal content remains reachable within the viewport.
- [ ] CSS colors are identical between desktop Web and Android WebView.
- [ ] Web runtime update detection calls `/api/runtime/version` and detects changed versions.
- [ ] Pre-entry pages refresh safely after a runtime update.
- [ ] Active transaction route does not auto refresh during sale/payment.
- [ ] Android WebView retains first-party cookies/session across app lifecycle events.
- [ ] Android renderer crash/unresponsive recovery returns to a usable state.
- [ ] Android offline/reload handling shows recovery path and reloads when network returns.
- [ ] MDM heartbeat continues on the expected scheduler and stops cleanly on lifecycle teardown.
- [ ] Native bridge info remains available to the WebView.
- [ ] APK installs, opens, reaches `https://cp-ipos-web.vercel.app/login/store`, and completes login.
## Signoff
1. QA Lead:
2. Engineering Lead:
3. Operations Lead:
4. Go-live decision (`Approved` / `Blocked`):
