# Stability / Network / API Audit

Date: 2026-07-28

## Scope

Checked local development evidence for symptoms reported by the user: slow UI, unstable API responses, frequent drops, slow network, and general POS instability.

## Evidence Found

- `tmp-next-dev.out.log` shows repeated slow API responses:
  - `GET /api/pos/session/current` reached `17.2s`, `19.1s`, `23.9s`, and multiple `2-5s` responses.
  - `GET /preview/pos` reached about `17.6s` and `20.6s`.
  - `GET /api/pos/features` reached `15.7s`.
  - `POST /api/pos/perf` reached `16.7s`.
  - `POST /api/pos/shifts/close` reached `34.2s`, with `next.js: 27.5s` and application code `6.7s`.
- `tmp-next-dev.err.log` shows Tailwind/PostCSS candidate scanning spikes:
  - `Scan for candidates` reached `7.0s`.
  - Full Tailwind processing reached `13.0s`.
- Next filesystem cache compaction took `69s`.
- Local command execution itself is slow. Several file reads and process checks took tens of seconds or timed out during this round, which points to local filesystem/cache pressure in addition to application API latency.
- 2026-07-28 recheck: full `corepack pnpm --filter backoffice-web lint` timed out twice, at about 184s and 304s, without visible ESLint errors. Targeted ESLint for current QR customer/table issuing paths passed but still took about 105-108s per run.

## Likely Causes

1. Local Next.js dev cold compile and filesystem cache pressure are a major source of UI slowness.
2. `.next` cache and Tailwind scanning are unstable under the current workspace state.
3. POS session and monitor APIs were repeatedly slow, especially `session/current` and `pos/monitor`.
4. Slow Supabase/network calls can surface as API delay because many POS routes resolve session, shift, device, features, and branch data before rendering.
5. Previous API calls could block the UI on non-critical metrics, telemetry, or long-running lookup paths. Recent changes reduced some of this risk by adding degraded responses and timeouts.
6. IT-admin tenant listing currently aggregates branch/session counts with separate broad queries. Before many tenants/branches are onboarded, replace this with paginated tenant summary via SQL view/RPC to avoid app-memory fan-out.

## Mitigations Already Added

- `/api/pos/session/current` now has bounded shift metric loading and reports `shift_metrics_degraded` instead of allowing metrics to hold the whole response indefinitely.
- Store-code lookup uses a short in-memory cache in development.
- Table QR menu/product loading uses caching and longer client/server timeouts.
- Table QR issuing now checks `TABLE_QR_SIGNING_SECRET` before Supabase table/session queries or QR session writes. Missing signing config fails fast with a Thai operator message and the client does not retry non-recoverable configuration errors.
- Customer table QR category chips now normalize duplicate/blank categories, reset safely when the menu payload changes, scroll the selected chip into view, and use a stricter horizontal touch rail so many categories can be swiped left/right without blocking taps.
- Customer table QR closed/paid states now show an auto-hiding popup instead of an inline red alert. The QR page polls active menu status every 5 seconds while visible, refreshes on focus, clears the cart, and disables actions when the linked table bill is paid or closed.
- IT-admin tenant summary now has a Phase 1 fix: a paginated service layer plus `get_it_admin_tenant_summary(...)` RPC migration. Production Supabase has the RPC/view applied and verified; if another environment misses the migration, the route still uses a compatibility fallback.
- Shift close open-bill errors are Thai and appear as auto-hiding popup notifications.
- Customer QR checkout is guarded until a food order exists, both in UI and API.

## Recommended Next Fixes

1. Keep `next dev` on webpack locally unless Turbopack panic logs are resolved.
2. Clear `.next` only when the dev/build cache is clearly corrupted or compaction stalls; then expect the first compile to be slow.
3. Move heavy monitor aggregation to a SQL RPC/view and cache tenant-level monitor results longer than 5 seconds.
4. Add server timing headers consistently to slow POS APIs and log degraded paths.
5. For production, verify Supabase latency from the deployment region and keep auth/session timeouts fail-fast with Thai retry messages.
6. Do not treat the first route after a dev restart as runtime slowness; retest after warm-up.
7. Production table QR requires `TABLE_QR_SIGNING_SECRET` in Vercel. Code changes cannot create signed QR links until that secret is configured and redeployed.
8. For IT Backoffice expansion, add `/api/it-admin/v1/*` as a versioned facade and keep large summary/list endpoints paginated. See `docs/IT-BACKOFFICE-API-DESIGN-2026-07-28.md`.

## Verification This Round

- Targeted ESLint passed for the shift close and QR customer files changed in the latest UI/API fixes.
- TypeScript typecheck passed after the latest UI/API fixes.
- Focused `table-qr-ordering.integration.test.ts` passed: 5 tests.
- Latest customer QR category fix: `corepack pnpm --filter backoffice-web typecheck` passed, and targeted ESLint passed for `src/components/table-order/table-order-mobile.tsx`.
- Latest customer QR closed-link popup/status polling fix: `corepack pnpm --filter backoffice-web typecheck` passed, and targeted ESLint passed for `src/components/table-order/table-order-mobile.tsx`.
- Latest system recheck: typecheck passed; Vitest passed 28 files / 68 tests; Vercel production inspect returned Ready. Full lint timeout is recorded as a tooling/performance bottleneck unless a future run prints actual lint errors.
- IT Backoffice API Phase 1 verification: typecheck passed; targeted ESLint for IT-admin v1/services passed; Vitest passed 28 files / 68 tests; production build passed on the 10-minute run. Production Supabase migration `20260728160924` was applied and RPC sample query passed. Local Supabase migration verification was blocked because local Postgres was not running.
- Supabase migration history has older drift outside this change, so avoid broad migration repair or `db push --include-all` until the missing local/remote history is reconciled.

## GitHub / Deployment Notes

- GitHub CLI is installed but `gh auth status` reports an invalid token for `sstdevelopaminno`.
- Git push may still work through Git's HTTPS credential manager, but PR creation through `gh` requires re-authentication with `gh auth login`.
- Root `image-3.png` remains untracked and should not be committed unless it is intentionally needed as documentation evidence.
