# POS Single Register Mode 2026-08-01

## Scope

Supports shops that operate as no-branch / single-cashier-register stores while keeping the existing secure store-code login.

## Package API Contract

IT Backoffice package APIs can set this mode through package metadata or top-level convenience fields:

- `store_mode: "single_register"`
- `branch_selection: "hidden"`
- `no_branch_mode: true`
- `single_device_mode: true`

When enabled, package create/update normalizes:

- `max_branches = 1`
- `max_devices = 1`
- `metadata.login_mode = "single_register"`
- `metadata.branch_selection = "hidden"`
- `metadata.max_cashier_devices = 1`

Changing a tenant contract to a package copies package branch/device/user limits into the contract unless the IT API explicitly supplies overrides.

## Login Behavior

- Store-code login remains the first step.
- The server resolves the tenant package/active contract and reads package metadata server-side.
- If the package is `single_register` and the tenant has exactly one active branch, `/api/auth/store-code/verify` skips branch selection and moves to employee-code login.
- After employee verification, `/api/auth/devices` marks `auto_select_single_device` when the package is single-register and there is exactly one cashier device.
- The device login page auto-opens that single allowed device. If it is disabled/offline or in use without override permission, the page stays on device selection and shows the existing error/choice behavior.
- Employee verification recovery: if a single-register login cookie is still at `store_verified`, `/api/auth/session/context` and `/api/auth/employee/verify-code` recover the only active branch server-side before returning or verifying.

## Guardrails

- Do not trust client flags for no-branch or single-device mode.
- Keep one internal branch row for data scoping even when the user-facing package says "no branch".
- Do not skip branch selection when a tenant has multiple active branches; fix tenant setup first.
- Do not auto-select a device that the employee cannot open.
## Device List Reliability

- /api/auth/devices must return the cashier device list even if active-session occupancy or package mode lookup is slow. Those lookups degrade with warnings instead of blocking the device selection page.
