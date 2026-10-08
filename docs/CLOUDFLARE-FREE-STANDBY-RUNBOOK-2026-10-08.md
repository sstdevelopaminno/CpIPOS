# CpiPOS — No-Upstash operation and Cloudflare Free standby runbook (2026-10-08)

## Status and architecture

- **Production origin stays Vercel**: \`cp-ipos-web.vercel.app\` (project \`cp-ipos-web\`). Do not redirect users or publish standby as Production without a separate, successful cutover approval.
- **Authoritative customer data stays Supabase Primary**. Redis is not required. No Cloudflare edge cache may serve authenticated sessions, tenant/branch data, payment, stock, Table QR state, print claims, or mutating APIs.
- **Production rate limiting mode:** \`RATE_LIMIT_BACKEND=memory\`. It retains API-level limits **per Vercel process only**, not across function instances. Application-level per-tenant/employee auth and session checks must remain unchanged.
- **Independent safety gate:** Vercel platform DDoS mitigation is automatic. Consider a **single, conservatively tuned** Vercel WAF IP-based rate limit for the login POST routes listed below. WAF must be confirmed *active*, not just saved as draft. Monitor matched requests and shared-NAT false positives before blocking.
- **Cloudflare Free is not a server backup on its own.** Free DNS/CDN/proxy does not host Next.js server-side routes or replicate Supabase. Free Load Balancing/failover is not included; Cloudflare Load Balancing is a separately billed add-on. Do not claim hot standby without a second deployed healthy runtime and a manual failover drill.
- **Vercel does not recommend a Cloudflare reverse proxy in front of Vercel**: it can reduce bot/firewall visibility, increase latency and introduce caching bugs. Keep Vercel hostname/direct origin for now.

## A. No-Upstash Production acceptance

Preflight (read-only, prints names/warnings, not secrets):

\`\`\`bash
node scripts/check-production-readiness.mjs
# Allowed memory-only result: status="ready_with_warnings", rateLimitBackend="memory"
# If true distributed throttling is required in a later release:
node scripts/check-production-readiness.mjs --distributed-rate-limit-required
\`\`\`

*Do not* use an empty fake Upstash REST URL/token. Never select \`RATE_LIMIT_BACKEND=upstash\` without both verified credentials: login flows may intentionally fail closed.

**High-risk login paths** (scope WAF condition to method \`POST\`):
- \`/api/auth/store-code/verify\`
- \`/api/auth/register-user/verify\`
- \`/api/auth/employee/verify-code\`
- \`/api/store/login-context\`

**Suggested conservative initial WAF policy (review against real traffic):** match only these POST paths; identify by client IP; **100 requests per 60 seconds** as an initial ceiling across those paths. Prefer logging/observing before enabling deny/429. Treat the threshold as a starting hypothesis, **not** measured customer behavior or an already installed rule. Single offices, malls, and staff sharing one NAT can accumulate attempts from many terminals. Different providers' counters may be regional and are *not* equivalent to a strictly globally shared per-employee counter. Do not create an indiscriminate \`/api/*\` rule that blocks normal kitchen, printer, sales, MDM, payment callbacks or internal polling.

Acceptance evidence before marking WAF **PASS**:
1. Record rule ID and Vercel dashboard state **active/published**, action, paths, POST method, limit, period, environment, costs and rollback.
2. Record legitimate multi-cashier check from a shared store network (no 429 at ordinary workflow rate).
3. Run **small, bounded, permissioned** staging/test traffic for rate-limit response; avoid flooding live stores or exhausting Free quotas.
4. Capture 429/Retry-After behavior and denial logs; validate that devices in other branches remain usable.
5. Record monitoring owner and reversible disable/restore steps.

A successful GitHub CI or presence-only environment check does **not** prove WAF enforcement.

## B. Cloudflare Free: safest low-cost standby sequence

**Prerequisites**: Cloudflare account, domain owned by company (optional for \`*.workers.dev\` testing), independent review of Free limits and all required server-only secrets. **No Cloudflare account or credentials are connected to this assistant.** Do not paste credentials into PRs, chat, commits, or public logs.

### Option B1 — status/incident page (realistic Free use)

1. Create a separate Cloudflare Pages/Workers **static status or maintenance page** on a test \`workers.dev\`/Pages hostname. This page cannot take POS payments or process stock.
2. Test it independently when Vercel's origin is unreachable.
3. Publish an alternative contact/support URL in a stored runbook. Never display a fake POS login or collect customer credentials on a status page.
4. Only after a rehearsal, use a **company-owned custom domain** to direct users to the status fallback in an incident. The existing \`*.vercel.app\` hostname cannot be reassigned to Cloudflare. Restore Vercel routing after recovery.

### Option B2 — experimental Next.js standby (NOT yet validated)

Existing repo wiring:
- \`apps/backoffice-web/wrangler.toml\`: \`name = "pos-backoffice-web"\`, \`main = ".open-next/worker.js"\`, \`workers_dev = true\`, Node compatibility flag.
- \`apps/backoffice-web/open-next.config.ts\`: OpenNext adapter configuration.
- \`apps/backoffice-web/package.json\`: \`cf:build\` / \`cf:preview\` / \`cf:deploy\` scripts and Wrangler/OpenNext dependencies.

**Do not run \`cf:preview\` or \`cf:deploy\` against a customer destination until a build, security review and test tenant are approved.** From a trusted checkout using the correct Node/pnpm versions:

\`\`\`bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter backoffice-web cf:build
# If the adapter build succeeds, inspect output size and plan restrictions first.
# Then separately test a Cloudflare deployment on a non-customer workers.dev hostname.
\`\`\`

Cloudflare Workers Free has request and CPU-time limits. Complex Next.js + Supabase POS flows may exceed those limits even if \`cf:build\` succeeds. Cloudflare documentation for Next.js now recommends *vinext* for new projects; existing OpenNext configurations can be maintained after compatibility testing. Do not switch the live stack merely because the package supports a Cloudflare build.

A valid **warm standby** requires:
- Actual successful Workers deploy on a **separate test hostname** and a live \`/login/store\` response.
- Safe encryption and correct server-only environment for Primary Supabase; no \`SUPABASE_SERVICE_ROLE_KEY\` or Trial secret in client bundles.
- Browser/cookie/SameSite and POS session re-login proof when hostnames change; cross-domain session cookies should never be assumed to transfer.
- Auth, per-tenant/branch isolation, payment callbacks, Table QR, realtime, Kitchen, print-agent claim/ACK, device bootstrap and high-frequency polling acceptance on Workers.
- Free quotas, CPU, bundle limits and a backpressure/incident plan (no user-facing silence).
- Reviewed manual cutover+rollback steps and authoritative health checks. Never direct payment-provider webhooks to an untested standby.
- **Separate Supabase backup and restore evidence**: two frontends pointing to the same Supabase database are *not* independent data backup or database failover.

### Domain and CDN cautions

- Cloudflare proxy requires a company-controlled domain. For an external DNS manager with Vercel deployment, prefer **DNS-only** records initially to preserve Vercel Firewall visibility.
- Never apply broad "Cache Everything" rules to \`/api/*\`, \`/login/*\`, \`/preview/pos/*\`, \`/download/*\` signed tokens, or any HTML containing personal/session/tenant data.
- An external Cloudflare reverse proxy in front of Vercel may break request IP attribution and reduce bot protection; re-test headers, payments, customer-facing auth and WAF before enabling.
- **Do not make a zero-downtime claim**: Cloudflare Free automatic health-check based Load Balancing is not included.

## C. Release gates and current status

| Gate | Current state (2026-10-08) |
| --- | --- |
| Vercel production selected backend | \`memory\` explicitly added in project environment; setting only affects a new deployment, but matches app's existing default |
| Supabase / RLS / checkout | No database changes in this work package |
| Repo preflight memory option | Modified source, tests required before merge |
| Vercel WAF rule actually active | **NOT VERIFIED** until dashboard rule ID, active state and harmless test evidence are recorded |
| Cloudflare static status site | **NOT DEPLOYED**; needs account and distinct hostname |
| Cloudflare full POS standby | **NOT DEPLOYED/NOT TESTED**; strict Free limits and transactional compatibility must be confirmed |
| Production promotion | **NOT PERFORMED** by this work package |
| Physical printer and multi-store E2E signoff | Still outstanding (#74 / #153) |

## Primary sources (verify current pricing/limits when executing)

- https://vercel.com/docs/vercel-firewall
- https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing
- https://vercel.com/kb/guide/cloudflare-with-vercel
- https://developers.cloudflare.com/load-balancing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/
