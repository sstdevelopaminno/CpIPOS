# Vercel Hobby Fluid Active CPU — low-risk capacity review (2026-11-08)

## Context
Vercel Hobby team-level usage screenshot: Fluid Active CPU at 3h55m / 4h for the displayed last-30-days window. This is a capacity warning, not evidence of a deployment failure or attribution to a particular app. The team hosts several projects, so do not assume that CpIPOS is solely responsible.

## 1. Repeated API calls
- POS sales monitor used a 30s default polling interval while `/api/pos/monitor` already caches its underlying result for 60s. The default is aligned to 60s. A 15s passive focus/visibility cooldown prevents duplicate monitor requests. In-flight protection and hidden-tab suppression remain.
- The legacy attendance display retains its 20s visible polling cadence, but now skips hidden tabs and concurrent polls.
- **Not changed:** Kitchen KDS active/idle cadence, POS orders, table QR, payment status, shifts, print execution, MDM commands, tenant authorization.

## 2. Cron Jobs
- No `crons` entry exists in `apps/backoffice-web/vercel.json` or the company website's `vercel.json` at this checkpoint.
- Verify Vercel project-level Cron Jobs in the dashboard, plus any external monitors/webhooks invoking public endpoints. Do not disable scheduled jobs without checking their operational purpose.
- GitHub Actions workflow schedules do not themselves count as Vercel Function CPU unless they invoke hosted endpoints.

## 3. Cache policy
- The POS monitor server cache remains 60s with stale fallback; cache remains scoped to its authenticated tenant/branch.
- Kitchen queue, payment confirmation, orders, and tenant-specific transaction responses remain uncached by CDN. Do not add shared `public` or `s-maxage` caching to authenticated API responses.
- Existing KDS alert settings, feature gate and other small configuration caches remain unchanged.

## 4. Verify usage and impact
1. Open Vercel > team > Usage > Fluid Active CPU, select the same billing period and inspect the **by-project** breakdown (and, if enabled, by-function).
2. Compare CPU and Function Invocations on the same dates, before/after the eventual deployment. Record the top 3 projects and highest-cost routes.
3. Check production logs, 429s/5xx, p95 latency and Kitchen/QR/Payments UAT after deployment.
4. Verify website/marketing app usage separately. A 4-hour Hobby quota belongs to the team, not each project.
5. If observability metrics are inaccessible on the current plan, record `not measurable`, not `fixed`; screenshots or dashboard export are needed for attribution.

## Rollout
This change must be reviewed/CI tested and deployed explicitly. No database migrations, production configuration, secrets, cron settings or billing plan changes are included. Never merge merely to clear a yellow dashboard indicator. Capacity warnings clear when actual measured use falls within the plan's allowance or the billing period resets.
