# CpiPOS Cloudflare emergency standby — 10 November 2026

## Incident and limits
Vercel Hobby reached Fluid Active CPU 4h04m / 4h; Vercel returned HTTP 402 and temporarily paused deployments. Support declined another courtesy unblock because the one-time 3x Hobby unblock had already been used. A Vercel deployment showing READY does **not** prove its live URL is available.

**This pull request is PREPARATION, not customer recovery.** It must not be represented as a working POS backup. Cloudflare has not been linked or deployed from this session, and there are no Cloudflare API credentials available to the assistant. The only GitHub-secret names used by the manual status action are `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; never add their values to a repository, PR, chat, or public logs.

## Deployed components (once owner authorizes)
1. **Static incident Worker** at a separate `cpi-incident-status.<account>.workers.dev` hostname. It uses no database secrets and deliberately exposes no POS login, sale or payment endpoint. It is an informational fallback only.
2. **OpenNext POS build probe** (GitHub PR CI) for `apps/backoffice-web`. The probe produces an artifact locally in CI but does not publish a Worker, DNS route, API or production credentials.
3. **Full POS standby runtime** is blocked until the CI build, Cloudflare account connection, exact environment/secrets setup and real-test acceptance have been completed. Free Workers have a 10ms request CPU limit; authentication, SSR, Kitchen and POS payment flows can exceed it. Do not promise production suitability or 0 THB.

## Status Worker release
1. In Cloudflare create/confirm an account with Workers enabled, with free-plan quota available; do not transfer DNS or add billing without authorization.
2. In GitHub repository Actions secrets set **names** `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`; token permissions should be restricted to Workers Scripts edit for the intended account. Do not paste values into chat or source.
3. After merging and CI, open **Actions → Cloudflare DR → Run workflow → action: deploy-status** on branch `main`. This deploys only the independent notice using `ops/cloudflare-incident-worker/wrangler.toml`.
4. Verify the actual `*.workers.dev` URL (HTTP 200 for `/`, `/health` returns `status: incident`) from an independent network. Publish that URL to customers through an independent channel only if approved. No custom DNS is changed.
5. To reverse: disable/remove the status Worker in Cloudflare dashboard. There is no POS or Supabase rollback for this static page.

## POS staging acceptance before any traffic switch
- OpenNext/Next.js 16 Cloudflare build success **and** Wrangler bundle-size/CPU/free-quota check.
- Stage isolated test tenant, verify store-code login, shift, product load, dine-in/takeaway order, Kitchen KDS/ACK and cancellation locks, tablet/mobile sync, 58/80mm printing and print-claim idempotency, payment callbacks, subscription billing, IT/MDM and reconnect.
- Use the **same authoritative Supabase data plane** after explicitly scoped credentials and tenancy checks. No duplicate databases or blind replication. Do not add a shared CDN Cache Everything rule for `/api/*`, auth, tenant, payment or kitchen.
- Validate cross-hostname cookies, third-party callbacks/webhooks, permitted origins and app endpoints. A working browser homepage is not POS acceptance.
- Never redirect customer traffic, change DNS, alias or package, create billable resources, or deploy secrets to an untested full POS Worker without explicit approval and evidence.
- A standby web server is **not** a database backup. Separately verify Supabase backups and RPO/RTO.

## Quick independent verification
```sh
node --test ops/cloudflare-incident-worker/worker.test.mjs
corepack pnpm install --frozen-lockfile
corepack pnpm --filter backoffice-web cf:build
```

## Decision log
- Cloudflare is proposed as an independent standby. Existing project includes `wrangler.toml`, `open-next.config.ts` and `cf:build` but no verified live Cloudflare POS.
- Because customers are blocked now, the static notice is useful only for outage communications. It does **not** restore actual POS sales.
- The primary Vercel Hobby limit will not be lifted by deploying anything to Cloudflare; a tested alternate origin is necessary, or an appropriate paid Vercel plan, before sales can resume.

## Build blocker discovered and isolated workaround
On 10 November 2026 the actual OpenNext PR build failed: `Node.js middleware is not currently supported`. Next 16's `src/proxy.ts` runs on Node, while the currently pinned Cloudflare adapter rejects it. For **Cloudflare build only**, `scripts/cloudflare-standby-build.mjs` temporarily converts the reviewed file into Edge `src/middleware.ts` by changing only the exported function name, builds OpenNext, then restores `src/proxy.ts`. The production Vercel source is unchanged. A source contract test asserts no auth, tenant, cookie or route changes during conversion. This is still **not** proof Edge session refresh works on Workers; runtime acceptance is mandatory.

Run from repository root: `node scripts/cloudflare-standby-build.mjs`. Do not use the old direct `cf:build` in a checkout containing `proxy.ts` unless the Cloudflare adapter has gained compatible Node middleware support.

## Optional isolated POS staging deployment (additional safe gate)
The GitHub Action `Cloudflare DR` now offers `deploy-pos-staging` only from `main`, with explicit confirmation `TEST-ONLY`. It uses a dedicated Cloudflare Worker `cpi-pos-standby-stage` on its own `workers.dev` hostname **without any production DNS route**. This operation must be run only after an owner configures a dedicated testing Supabase tenant/project and a Cloudflare account. A build success is not permission to use production Supabase credentials.

Required GitHub Actions secret names:
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Cloudflare Worker edit permissions, least privilege).
- `CPI_DR_TEST_SUPABASE_URL` and `CPI_DR_TEST_SUPABASE_ANON_KEY` (test database only).
- `CPI_DR_TEST_SUPABASE_SERVICE_ROLE_KEY` (test database only, **never** production).
- `CPI_DR_TEST_POS_SESSION_HANDOFF_SECRET` (test-only independent key).

Never paste secret **values** in chats, GitHub Issues or code. After optional staging deploy, verify `/login/store` and test-tenant permissions, payment safeguards, cookies, Kitchen, print claims, CPU and Worker size before even considering live traffic. Staging is not customer recovery and does not authorize changing domain names or billing.
