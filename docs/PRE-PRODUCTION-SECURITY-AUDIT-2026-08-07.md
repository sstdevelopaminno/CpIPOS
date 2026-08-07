# CpIPOS Pre-Production Security Audit — 2026-08-07

## Scope

This audit was performed after the Production database housekeeping/reorganization work. It compares the live Supabase schema and privileges with the current Web POS / Mobile POS code paths that control authentication, tenant/branch scope, payments, table QR ordering, feature entitlement, and privileged service-role operations.

## Verified Database Baseline

- Production contains only `NDL-TH-001`, `BBQ-TH-002`, and `TEST-TH-003`.
- Critical tenant/branch relationship checks across devices, users, POS sessions, orders, order items, payments, products, ingredients, recipes, table bill/QR sessions, mobile member transactions, and print jobs returned zero cross-tenant/cross-branch mismatches.
- Tenant-scoped public base tables have RLS enabled.
- No RLS-disabled public base table is accessible to `anon` or `authenticated`.
- Invalid indexes: 0.
- Unvalidated public/app constraints: 0.
- Public SECURITY DEFINER functions are not executable by `anon` or `authenticated` after the Phase 2 hardening migrations.
- Public compatibility views reviewed in this audit use security-invoker behavior; no confirmed RLS bypass was found.

## Safe Fixes Applied During This Audit

1. `apps/backoffice-web/src/lib/feature-unlock.ts`
   - Production now always fails closed for the development feature-unlock flag.
   - Missing/misconfigured feature-unlock env can no longer silently unlock all subscription features in Production.

2. `apps/backoffice-web/src/app/it-admin/login/page.tsx`
   - Removed raw Supabase Auth status/name/message and caught exception details from the browser-visible login error.

3. `apps/backoffice-web/src/app/api/auth/employee/verify-code/route.ts`
   - Added rate limiting before employee-code lookup.
   - Limit is scoped by tenant + branch + client IP.
   - Auth-sensitive limiter is configured to fail closed when a configured distributed backend is unavailable in Production.

4. `apps/backoffice-web/.env.example`
   - Development feature-unlock examples now default to false.
   - Added employee verification rate-limit settings.
   - Documented that Production/serverless should use a distributed Upstash backend instead of per-instance memory limiting.

5. `apps/pos-mobile-web/src/app/api/mobile/sales/takeaway/hold/route.ts`
   - Removed the obsolete RPC signature probe.
   - Removed the non-atomic direct-table fallback.
   - Mobile takeaway hold now uses the live transactional RPC path only.

6. `apps/pos-mobile-web/next.config.js`
   - Added HSTS, nosniff, frame denial, referrer, permissions, and cross-origin opener security headers.

## Open P0 / High-Priority Items

### 1. Backoffice Next.js security baseline is outdated

The lockfile currently resolves Backoffice/Web POS to Next.js `16.2.6`. The July 2026 Next.js security release requires at least `16.2.11` for the 16.2 line to address multiple HIGH and MEDIUM vulnerabilities. Mobile resolves to `15.5.22`, which is above the July patched `15.5.21` baseline.

Required action:
- regenerate the pnpm lockfile with Backoffice Next.js and `eslint-config-next` upgraded to a patched supported release (`>=16.2.11` within the intended release line),
- run typecheck/lint/test/build and deployment smoke verification.

Do not hand-edit only the package version without regenerating the lockfile.

### 2. Mixed/split payment transfer validation uses the first payment line

`apps/backoffice-web/src/app/api/pos/payments/route.ts` derives the payment method from `payment_lines[0]` and only enters transfer verification when that first line is `bank_transfer`.

Risk:
- a split payment with cash first and bank transfer later can bypass the bank-transfer slip/override/QR-only verification branch,
- cash-received calculation also treats the total payment as cash when the first line is cash.

Required action:
- derive `hasBankTransfer` from all payment lines,
- calculate cash amount from cash lines only,
- add split-payment regression tests.

### 3. Public Table QR `update_order` can replace the entire table bill

The public table-order endpoint accepts `action=update_order`. `updateTableQrOrderItems` deletes all `order_items` for the table-session order and inserts the submitted replacement set. It does not restrict edits to items originally submitted by the same QR event/session.

Risk:
- a holder of a valid active table QR token can replace/remove other items on the same open bill before pending-payment state, including items not created by that specific update event.

Required action:
- decide the intended customer-edit model,
- either disable public whole-bill replacement or introduce item/submission ownership/versioning and a transactional update RPC,
- ensure already-fired kitchen items cannot be silently removed without an auditable cancellation flow.

## Open P1 / Controlled Changes

### Payment-time stock/payment completion is not fully atomic

Current Web POS intentionally defers recipe stock deduction until payment. The compatibility direct-payment path inserts payments, deducts stock, and completes the order across multiple operations with partial compensation. Simply switching to the existing `complete_pos_payment_tx` RPC is not correct because that RPC does not currently perform the deferred stock deduction.

Required action:
- create a new payment-time transactional RPC that validates the queued order and payment lines, performs branch-aware stock deduction, inserts payment rows, completes the order, and updates table state in one transaction,
- preserve payment idempotency and negative-stock branch policy,
- add failure-injection/integration tests before changing the default path.

### Public Table QR rate limit is per-instance memory

`apps/backoffice-web/src/app/api/table-order/[token]/route.ts` has a local in-memory 20/minute bucket. On horizontally scaled/serverless deployment it is not a reliable global limit.

Required action:
- migrate this endpoint to the shared distributed rate-limit adapter,
- use a token/session + client-IP key and keep idempotency enforcement in the database.

### Role/profile semantics after schema reorganization need normalization

`pos_user_profiles` is tenant-level while authoritative branch role is represented in `user_branch_roles`. Live data contains examples where `permission_role` differs from branch role.

Current pre-entry authentication reviewed in this audit derives the selected-branch role from branch membership, which is the safer authority. Do not rewrite profile roles blindly.

Required action:
- inventory all remaining `permission_role` consumers,
- formally document `user_branch_roles.role` as branch authorization authority,
- migrate/deprecate tenant-level legacy role fields only after consumer verification.

### Browser Content Security Policy

Web POS has several security response headers but no Content-Security-Policy. Mobile now has the same basic security header baseline but also lacks CSP.

Required action:
- introduce CSP in report-only mode first,
- inventory required Supabase, payment, image, and runtime origins,
- enforce after report validation.

### Supabase leaked-password protection

Supabase Security Advisor still reports leaked-password protection disabled. This is an Auth project setting, not a PostgreSQL migration.

Required action:
- enable leaked-password protection in Supabase Auth settings if the project plan supports it.

## P2 / Least-Privilege Cleanup

- `app` schema contains historical function EXECUTE ACLs for application roles, but those roles currently have no `USAGE` on the schema, so this is not a confirmed direct exposure. Remove dead grants only after function call-site review.
- Security-invoker compatibility views have broader grants than strictly necessary. Underlying RLS/privileges still apply; reduce grants only with consumer evidence.
- README still contains historical demo/bootstrap material that should be rewritten to match the current tenant-neutral reset baseline and remove static demo credential guidance.

## Release Gate

Before real customer traffic, the recommended minimum release gate is:

1. Upgrade Backoffice Next.js to a patched supported version and regenerate the lockfile.
2. Fix mixed-payment transfer verification.
3. Resolve or disable public whole-bill Table QR replacement.
4. Configure Production distributed rate limiting (Upstash) for authentication, then migrate public Table QR limiting to the same backend.
5. Run Web + Mobile CI, schema-drift check, Vercel deployments, and focused smoke tests for employee login, device selection, dine-in/takeaway payment, split payment, and Table QR ordering/update behavior.

The database housekeeping itself is not showing cross-tenant contamination or structural corruption; the remaining material risk is primarily in application authorization and transaction semantics above the database layer.
