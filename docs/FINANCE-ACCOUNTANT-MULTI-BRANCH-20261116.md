# CpiPOS Finance — accountant all-branch access (Draft, 2026-11-16)

## Business request
- Add **การเงิน / Finance** as a primary owner menu.
- Only Owner and Accountant can open Finance, never Manager/Cashier/Kitchen.
- Owner login and existing POS flows stay unchanged.
- Accountant uses two **screens**: Store code -> Accountant employee code.
- Accountant skips branch selection, cashier device selection, POS shifts and sales UI.
- Accountant covers all active branches within one tenant, never another tenant.

## Production safety and credential decision
Store codes are public tenant identifiers; some legacy employee codes are derived or
have demo aliases. **Two codes alone are not sufficiently strong credentials for
tenant-wide financial access.** The accountant employee-code screen therefore also
requires the existing staff PIN (4-6 digits) in that same screen. This keeps a two-screen
entry path; PIN enrollment is mandatory before activation. If a code/PIN is missing,
access must fail closed rather than fallback to another staff role or default branch.

This initial implementation uses an explicitly set `pos_user_profiles.employee_code`
only (not UUID-derived/demo codes), `users_profiles.pin_hash` with bcrypt comparison,
and a purpose-separated HttpOnly, SameSite=Lax, signed, 1-hour Finance cookie. Finance
cookies cannot authenticate regular POS API routes.

## Role scope
The current database has **branch-level** `user_branch_roles`, not a dedicated
tenant-wide Finance grant. To avoid silently expanding a single-branch employee's
access, the server requires an Accountant role assignment for **every active branch**
of the same tenant. It revalidates tenant active status, user active status, branches
and assignments on each Finance page request. Newly added branches must receive an
Accountant grant first or Finance access fails closed.

A future additive and audited `tenant_finance_access_grants` schema can replace
this requirement, after owner authorization, migration review and RLS checks.
No database migrations are included in this branch.

## Implemented scaffold
- Store-code login offers opt-in **เข้าสู่ระบบฝ่ายบัญชี (ทุกสาขา)**.
- Signed store verification must precede the accountant login API.
- Dedicated Finance session without branch/device/shift.
- Finance landing screen shows verified all-branch scope only; **no accounting records,
  payments, balances, exports or ledger writes** are implemented.
- Owner gets a main Finance menu guarded server-side by POS role owner.
- Existing standard POS employee-code verifier rejects accountants and instructs
  them to use the Finance path.
- Accountant no longer inherits manager/sales menu or sales permissions.

## Package and main menu contract (2026-11-16)
- Finance is a **primary POS menu** placed after Shift (following current main-menu sidebar layout).
- Finance is included for **Business and CUSTOM** only. Starter, Growth, retired/unknown plans and inactive subscriptions are denied.
- Owner sees Finance in the normal POS sidebar only when the trusted package decision is true.
- Accountant sees only its separate Finance workspace; it never inherits POS sale/shift/menu access.
- Both owner direct page and accountant login/session recheck the effective current package server-side.
- This is **not** a new paid add-on or database entitlement row. Existing IT menu policy may explicitly hide/lock navigation, but it cannot grant Finance to an ineligible package.
- Current draft is a blank finance landing workspace; submenus and money data will be designed in a subsequent phase.
- No Production database writes or migrations.

## Release gates
1. Confirm employee-code and PIN enrollment for each test accountant, including all active branch roles.
2. Test same-tenant 1 branch, same-tenant multiple branches, missing role, inactive branch,
   revoked staff, cross-tenant replay, invalid/expired cookies and direct URL access.
3. Test store owner existing 3+ screen login and POS/shift flow without regression.
4. Validate per-IP rate limiting on Vercel's multi-instance environment; if memory
   backend is used, enforce/verify WAF throttling or stronger central rate limit.
5. Run typecheck, lint, unit/integration tests and deployed preview E2E;
   verify Android/Windows/PWA navigation and real multi-branch smoke.
6. Before enabling real accounting data: design tenant-scoped API guards and audit,
   ledger reconciliation, data correctness, idempotency and branch filtering.

**Do not merge to main, deploy Production, write live database data or advertise
real Finance functionality based on this scaffold alone.**
