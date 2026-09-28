# Development Handoff

- Checked at: 2026-09-29 00:01:17 +07:00
- Branch: `agent-docs-preflight-schema-drift`
- Latest commit: `9188ccfa4e6b605554d3adf31e791b251211f3ab` (`ci: add no-rebuild Vercel production promote`)

## Completed

- Help Center `/preview/pos/payments` is done with POS session guard, kitchen-role block, and menu policy enforcement.
- Package page `/preview/pos/payments/package` is done for owner/manager billing access.
- Support page `/preview/pos/payments/support` is done and has the browser-runtime fix so missing browser realtime config does not crash the page.
- Support Chat REST flow, conversation list, messages, attachments, read state, and close action are wired through the scoped bridge APIs.
- Service Worker is v6 (`cpipos-shell-v6`) and bypasses API, Next assets, RSC, and prefetch/state requests.
- No-rebuild Vercel promote workflow was added.

## Pending

- Replace `VERCEL_TOKEN` with a Vercel Personal/Account Authentication Token accepted by the Vercel API.
- Rerun the no-rebuild promote workflow after the token is fixed.
- Verify production Help Center, package role gating, Support page, and Support Chat against the live deployment.
- Run typecheck, lint, and build again after investigating why they hung in this local run.

## Current Production / Vercel Issues

- Vercel Hobby hit the 100 deployments / 24h limit.
- Use the no-rebuild promote workflow to promote an already READY deployment without consuming another rebuild.
- `VERCEL_TOKEN` still must be a Personal Authentication Token that `GET https://api.vercel.com/v2/user` accepts.

## Important Routes

- `/preview/pos/payments`
- `/preview/pos/payments/package`
- `/preview/pos/payments/support`
- `/api/pos/support-chat/conversations`
- `/api/pos/support-chat/conversations/[conversationId]`
- `/api/pos/support-chat/conversations/[conversationId]/messages`
- `/offline-pos.html`
- `public/sw.js`

## Deployment Workflows

- `.github/workflows/deploy-vercel-prebuilt-production.yml`: builds in GitHub Actions and deploys a prebuilt production artifact.
- `.github/workflows/promote-existing-vercel-production.yml`: promotes an existing Vercel deployment without rebuild and verifies `/api/system/build-info`.

## Validation This Run

- `corepack pnpm --filter backoffice-web typecheck`: interrupted after hanging with no diagnostics.
- `corepack pnpm --filter backoffice-web lint`: interrupted after hanging with no diagnostics.
- `corepack pnpm --filter backoffice-web test`: passed, 134 files and 569 tests.
- `corepack pnpm --filter backoffice-web build`: interrupted after hanging during Next production build optimization.

## Next Round

- Fix GitHub `VERCEL_TOKEN`, rerun promote, and confirm production build-info commit.
- Recheck the three Help Center routes in browser on production.
- Investigate local `tsc`, `eslint`, and Next build hangs before declaring the branch fully green.
