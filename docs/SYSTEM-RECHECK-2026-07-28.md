# System Recheck 2026-07-28

Date/time: 2026-07-28, after production deployment `345ba2f`.

## Current Source Of Truth

- Workspace: `E:\CpIPOS`
- Branch: `agent-docs-preflight-schema-drift`
- Production URL: `https://cp-ipos-web.vercel.app`
- Latest commits:
  - `345ba2f Fix table QR closed bill popup`
  - `3eec4a3 Fix table QR category rail`
  - `592dcf9 Fix table QR config handling`

## Verification Run

- `git status -sb`: clean before this documentation update.
- `corepack pnpm --filter backoffice-web typecheck`: passed.
- `corepack pnpm --filter backoffice-web test`: passed, 28 files / 68 tests.
- `cmd /c vercel inspect https://cp-ipos-web.vercel.app`: production Ready, alias points to latest production deployment.
- Full `corepack pnpm --filter backoffice-web lint`: timed out twice, once at about 184s and once at about 304s, without visible lint errors.
- Targeted ESLint for latest QR customer flow passed:
  - `src/components/table-order/table-order-mobile.tsx`
  - `src/lib/table-qr-ordering.ts`
  - `src/app/api/table-order/[token]/route.ts`
- Targeted ESLint for POS QR issuing flow passed:
  - `src/components/pos/table-qr-order-modal.tsx`
  - `src/app/api/pos/tables/[tableId]/qr-order/route.ts`

## IT Backoffice API Phase 1 Verification

- Implementation added locally; production Supabase migration applied; code pending commit/push/deploy at this checkpoint.
- `corepack pnpm --filter backoffice-web typecheck`: passed after adding the IT admin service layer and v1 API routes.
- `corepack pnpm --filter backoffice-web exec eslint src/app/api/it-admin/admin/tenants/route.ts src/app/api/it-admin/v1 src/lib/services/it-admin`: passed.
- `corepack pnpm --filter backoffice-web test`: passed, 28 files / 68 tests.
- `corepack pnpm --filter backoffice-web build`: first 5 minute run timed out; second 10 minute run passed. Treat the first timeout as local build/tooling latency unless a later run prints a real build error.
- `cmd /c supabase migration list --local`: could not verify local migration state because local Supabase Postgres was not running at `127.0.0.1:54322`.
- Production Supabase verification passed for `public.it_admin_tenant_summary_v`, `public.get_it_admin_tenant_summary(...)`, and a limit-1 RPC sample query.
- Migration history was repaired only for `20260728160924` after direct SQL execution. Existing older remote/local migration drift remains and must be reviewed separately before using broad `supabase db push --include-all`.
- After the first Vercel deployment, unauthenticated `HEAD /api/it-admin/v1/health` returned 500. Root cause: `requireItAdmin()` treated missing login as a generic internal error. Fix: map the known unauthenticated auth-context error to `401 unauthorized`.

## Stability Notes

- The application code passed typecheck and tests after the QR closed-bill popup and category rail fixes.
- Production is deployed and Ready on Vercel.
- The remaining signal is a tooling/performance bottleneck: full lint can exceed 5 minutes locally. Do not treat this as a code lint failure unless a later run prints actual ESLint errors.
- Targeted ESLint on the current high-risk QR paths is clean, but each targeted run still took about 105-108 seconds. This supports the existing stability audit finding that local filesystem/tooling latency is part of the slow-workspace problem.
- IT admin tenant listing no longer needs broad app-side aggregation in the main route after Phase 1. It now calls a paginated summary service and can use the SQL RPC/view after the migration is applied.
- The compatibility fallback still works if an environment misses the migration, but production now has `20260728160924_it_admin_v1_summary_api.sql` applied and verified.

## Guardrails For Next AI

- Start with `docs/ACTIVE-DOCS-INDEX.md`, `docs/AI-GUARDRAILS-CPIPOS.md`, this file, and `docs/CPIPOS-HANDOFF-2026-07-28.md`.
- Do not re-debug old QR login documentation; current QR work is table ordering at `/table-order/[token]`.
- Do not expose, log, or commit Vercel/Supabase secrets.
- Do not add customer-facing settings for `TABLE_QR_SIGNING_SECRET`; any future visibility should be IT/Admin health status only.
- If full lint times out again, run targeted ESLint for touched files and record the timeout as tooling latency unless ESLint prints real errors.
- For IT backoffice work, start from `docs/IT-BACKOFFICE-API-DESIGN-2026-07-28.md` and keep the public API under `/api/it-admin/v1/*`.
- The user approved commit/push/deploy after production migration verification.
