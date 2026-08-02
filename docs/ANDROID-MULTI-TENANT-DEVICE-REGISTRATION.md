# Android Multi-Tenant Device Registration

Date: 2026-08-02
Status: Documentation only. No production code changes.

## Purpose

Define how an Android 13+ CpIPOS fullscreen APK terminal should participate in the existing multi-tenant, multi-owner, multi-branch login and POS device model without hardcoding tenant, branch, or device data in the APK.

The Android APK is a runtime shell. Server-side CpIPOS auth/session/device validation remains authoritative.

## Current CpIPOS Behavior To Preserve

CpIPOS already uses a secure web login and POS pre-entry flow:

```text
/login/store -> /login/branches|employee -> /login/devices -> /preview/pos
```

Current invariants to preserve:

- one owner can have multiple branches
- store code resolves tenant/branch options server-side
- employee/owner/manager verification is server-side
- device selection and device status are server-side
- POS session and handoff cookie are server-created
- server never trusts client-sent tenant, branch, store code, or device code without validation
- service-role key is never exposed to client code
- feature gates, quotas, user roles, device status, and shift gate remain server enforced

## Proposed Architecture

```text
Android APK Shell
  -> loads existing CpIPOS web login flow
  -> optionally exposes safe Android device metadata through native bridge in later phase
  -> stores only safe local app/runtime state

CpIPOS Web Login Flow
  -> store code verification
  -> branch selection if required
  -> employee/owner/manager verification
  -> device selection or registration

CpIPOS Server
  -> validates tenant, branch, user, role, permission, device status, and policy
  -> creates POS session
  -> sets trusted cookies/server session state
```

No tenant or branch should be embedded into the APK package.

## Data Flow

### First Launch Device Binding

```text
Android APK opens /login/store
-> user enters store code
-> server validates store code and tenant status
-> branch selection appears if the tenant has multiple branches
-> user verifies employee/owner/manager credentials
-> user selects existing Android POS device or registers a new one when allowed
-> server validates tenant_id, branch_id, device_code, user role, permissions, quotas, and device policy
-> server creates POS session and returns to /preview/pos
```

### Device Registration Scope

Device registration must bind a terminal to:

```text
tenant_id
branch_id
device_code
device_name/device label
device_type = android_pos_terminal
status = active|inactive|maintenance
policy flags / quota state
```

The APK may display or store a safe label such as device name or local app installation ID, but it must not treat local values as trusted authorization scope.

### Returning User Flow

```text
APK launches
-> WebView loads CpIPOS URL
-> existing cookies/session are checked by server
-> if session valid, /preview/pos loads
-> if session invalid or expired, redirect to /login/store
```

The app must not invent or refresh POS sessions locally.

## Security Rules

- Never trust tenant_id, branch_id, device_code, store_code, role, or permissions from APK local storage.
- Server must revalidate tenant, branch, user, role, device status, and permission before POS access.
- Store only safe session/device metadata in the APK.
- Do not store Supabase service role key or admin secrets in the APK.
- Do not store manager/owner PINs or employee secrets in APK storage.
- Do not use a local Android device ID as authorization without server mapping.
- Device registration must enforce tenant/package quotas server-side.
- Device status changes must be resolved server-side before sales access.
- Cross-tenant device reuse must require explicit logout/reset and server re-registration.
- Offline data must remain tenant/branch partitioned in a later phase.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| APK stores trusted branch/device values | Cross-tenant access risk | Treat APK state as hints only; server resolves scope |
| Reusing tablet across shops leaves stale session | Wrong tenant or branch opens | Server session validation; clear/reset flow; environment label |
| Device quota bypass | Package enforcement broken | Device registration must be server-side and quota-checked |
| Offline future mode mixes tenant data | Data leak/corruption | Tenant/branch partitions and sync validation before offline phase |
| Native device identifiers differ by OS/vendor | Device mapping unstable | Use server-issued device record and safe app installation ID only as metadata |

## Implementation Phases

### Phase 0: Documentation

- Document Android registration rules only.
- Do not change existing login or device APIs.

### Phase 1: Android Shell Uses Existing Flow

- Load `/login/store` on first launch.
- Do not add native device registration screens.
- Do not bypass existing web login/device pages.

### Phase 2: Safe Device Metadata Bridge

- Add `CpIPOSBridge.getDeviceInfo()`.
- Return safe metadata only: app install ID, OS version, device model, native app version.
- Server may store this metadata during registration, but must not trust it as authority.

### Phase 3: Android Device Registration UX Enhancement

- Improve existing web device registration UI to identify Android terminals clearly.
- Keep server-side validation unchanged.
- Add support/debug display for current tenant/branch/device labels after server validation.

### Phase 4: Device Reset And Reassignment

- Add controlled logout/reset flow for moving terminals across tenants/branches.
- Ensure active POS sessions are revoked server-side.
- Ensure local WebView cache/session is cleared only through safe flow.

## Acceptance Checklist

- [ ] Android APK uses existing `/login/store -> branch/employee -> devices -> /preview/pos` flow.
- [ ] No tenant, branch, or device is hardcoded in APK.
- [ ] Device registration binds Android terminal to server-validated tenant, branch, and device record.
- [ ] Server never trusts client-sent tenant/branch/device values without validation.
- [ ] One owner with multiple branches remains supported.
- [ ] Many tenants and many store owners remain supported.
- [ ] Device quota and status rules remain server-enforced.
- [ ] APK stores no service-role key, admin secret, PIN, or employee secret.
- [ ] Existing web login/device routes are not broken.
- [ ] No code changes are introduced during documentation phase.
