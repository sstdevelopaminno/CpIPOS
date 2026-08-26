# Codex Handoff — FF0001 User / Owner Bootstrap

Date: 2026-08-26
Base production branch at handoff: `agent-docs-preflight-schema-drift`
Base SHA inspected: `22e424807d84d590418633f412ce30d46a36016b`

## Read this first

Before editing code:
1. Read `context.md`, `README.md`, and the existing production/readiness docs relevant to POS auth and user management.
2. Re-fetch the current HEAD of `agent-docs-preflight-schema-drift`; do not assume SHA `22e4248` is still current.
3. Inspect only files relevant to this issue. Do not broad-refactor the repository.
4. Preserve all existing multi-tenant, branch-scope, device, session, and owner/manager security constraints.
5. Do not change Production Supabase data unless the task explicitly requires it. The urgent FF0001 data repair described below is already complete.

## Incident summary

Customer symptom on FF0001:
- Could not create a POS user with role `owner`.
- Edit/Delete controls in POS User Settings appeared unavailable.
- Customer could not complete owner administration.

Production evidence:
- Tenant: `FF0001`
- Branch: `FF0001-AYU-01`
- Before emergency repair this branch had `owner_count = 0`, `manager_count = 1`, `user_count = 1`.
- Other checked active branches had at least one owner; this was isolated to FF0001 data.
- `/api/pos/users` GET was healthy (HTTP 200). No evidence of backend crash for this issue.

Root cause in current code:
- `apps/backoffice-web/src/app/api/pos/users/route.ts`
  - `canActorAdd()` allows owner or manager.
  - POST currently silently converts a manager request for `owner` or `manager` into `staff`:
    `const role = auth.branchRole === "manager" && (requestedRole === "owner" || requestedRole === "manager") ? "staff" : requestedRole;`
  - This makes a branch with zero owners impossible to recover through normal User Settings.
- GET returns `can_edit` / `can_delete` from role policy.
  - A manager cannot edit an owner, cannot edit itself, and cannot delete users.
  - Therefore a branch containing only the current manager naturally renders Edit/Delete disabled.
- `apps/backoffice-web/src/components/pos/pos-users-module.tsx`
  - UI relies on API `can_edit`, `can_delete`, `metadata.can_add`, `metadata.can_delete`.
  - Do not simply remove the disabled attributes; fix authorization semantics server-side first.

## Emergency production repair already completed

Production Supabase project: `CpiPOS-001`.

The sole FF0001 branch role was repaired from `manager` to `owner` for the existing administrative account, scoped only to tenant `FF0001` / branch `FF0001-AYU-01`.

Read-back after repair confirmed:
- role = `owner`
- profile is active
- employee code exists
- PIN hash exists
- there were no active POS sessions at the time of the repair

This means a fresh login should receive owner permissions, including `users:view` and `users:manage`, from `computePermissions()` in `apps/backoffice-web/src/lib/pos-session-guard.ts`.

Do NOT repeat this DB promotion unless a fresh read proves the role is wrong again.

## Required permanent code fix

Implement a safe first-owner bootstrap path without weakening normal authorization.

### Server behavior

In `apps/backoffice-web/src/app/api/pos/users/route.ts`:

1. Determine whether the current branch already has any `owner` role before deciding the requested create role.
2. Allow a `manager` to create role `owner` ONLY when that branch currently has zero owners.
3. Once an owner exists, a manager must NOT be able to create another owner or another manager.
4. Do not silently downgrade requested `owner`/`manager` to `staff`.
   - For prohibited requests return an explicit 403 error code/message.
5. Preserve branch scoping through `resolveSessionBranchId()`.
6. Preserve employee-code uniqueness and all existing PIN/approval checks.
7. Avoid a race where two managers can both create the first owner concurrently.
   Preferred solution: enforce the bootstrap atomically server-side (transaction/RPC or another concurrency-safe guard). If an atomic DB primitive is not practical in this patch, document the race and add a second owner-existence check immediately before role write, but atomic is preferred.
8. Include an audit metadata field for the exceptional first-owner bootstrap, e.g. `first_owner_bootstrap: true`.

### GET/UI behavior

Expose enough metadata to make the UI explicit, for example:
- `branch_has_owner`
- `can_create_owner`

Then in `apps/backoffice-web/src/components/pos/pos-users-module.tsx`:
- Keep Owner selectable for an owner.
- For a manager, allow Owner only when `can_create_owner === true`.
- Otherwise disable/hide Owner with a clear explanation.
- Never present a role choice that the server will silently rewrite.
- Do NOT globally enable Delete for manager. Delete remains owner-only.
- Do NOT remove self-delete protection.

If product requirements want manager self-profile editing, implement that as a separate narrowly scoped rule; do not bundle an unrestricted manager self-edit elevation into this incident fix.

## Tests required

Add targeted tests covering at least:
1. Owner can create owner.
2. Manager + branch with existing owner -> cannot create owner (403).
3. Manager + branch with zero owner -> can create exactly the first owner.
4. After first owner exists, same manager cannot create a second owner.
5. Manager cannot create manager if policy remains owner-only.
6. Requested owner is never silently persisted as staff.
7. Owner GET metadata -> edit/delete privileges remain as intended.
8. Manager GET metadata -> delete remains false.
9. Cross-branch owner bootstrap is rejected.
10. Existing staff/manager create flows are not regressed.

## Verification sequence

Run the narrowest commands first, then production build:
- targeted user-management tests
- relevant typecheck
- relevant lint
- `git diff --check`
- production build for `backoffice-web`

Do not commit/push until all errors are resolved. Existing unrelated warnings may remain only if confirmed pre-existing and non-blocking.

After deploy, verify with a fresh POS login/session:
- `/api/pos/users` returns role `owner` for FF0001 administrative account after the emergency repair.
- Add User modal can create the intended owner/manager/staff roles according to policy.
- Edit button is enabled for owner-authorized targets.
- Delete is enabled only for owner and never for the current owner's own row.
- No 4xx/5xx regression on `/api/pos/users` GET/POST/PATCH/DELETE.

## Important unrelated context

Do not mix this patch with the separate FF0001 shift/logout lifecycle investigation unless a direct dependency is proven. Keep the user-management patch narrow and independently testable.
