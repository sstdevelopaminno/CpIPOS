# Disaster Recovery — Vercel Pro primary and Cloudflare standby (10 Nov 2026)

## Current facts, tested externally
- Team `sstdevelopaminnos-projects` upgraded to **Vercel Pro**, confirmed with Vercel integration after the Hobby CPU pause.
- `https://pos.cuttingpointinnovation.com/login/store` returned **HTTP 200** with CpiPOS Thai/English/Lao login content; Vercel runtime error report for the POS project found no errors in the last 1h. This **does not test checkout, kitchen, payment or authenticated data**.
- `pos.cuttingpointinnovation.com` domain is verified against Vercel project `cp-ipos-web`.
- The company's `www.cuttingpointinnovation.com` and apex map to a separate older Vercel project that is **not accessible in the current connector**. Do not call this website production accepted without an independent probe and project ownership review.
- Cloudflare status Worker `cpi-incident-status.sstdevelopaminno.workers.dev` was enabled by GitHub action and its `/health` previously returned `status:incident`; this **is not POS failover**.
- Cloudflare OpenNext POS build **passed CI Wrangler dry-run**, total upload ~20,919 KiB, gzip ~3,529 KiB. **No** Cloudflare POS Worker runtime has been deployed or accepted with authenticated test transactions.
- Both Supabase projects `CpiPOS-Communications` and `CpiPOS-001` were reported `ACTIVE_HEALTHY` by Supabase integration. This is not backup/restore verification.

## Outage architecture and failure domains

Vercel Pro = primary for web/API. Cloudflare Workers = independent runtime candidate; Supabase remains the single authoritative transaction database. A Cloudflare standby using the same Supabase **cannot recover a Supabase region outage** or a database data-loss event. GitHub serves build/release source; APK/installer artifacts need their own tested storage/availability plan. Customer Android and Windows integrations may pin the primary API URL; failover must check app host configuration and update behavior, not just browser DNS.

## Scope and acceptance by service

| Component | Current DR maturity | Blocker for true failover |
| --- | --- | --- |
| CpiPOS web / transaction APIs | Build and Wrangler dry-run PASS; isolated Worker not deployed | Separate test Supabase credentials and workers.dev staging; CPU and auth, order/payment/kitchen/printing/MDM UAT |
| CpiPOS IT/admin and MDM | Runs within / alongside CpiPOS; not accepted on Workers | Admin auth, session/cookie isolation, device command delivery, IT audit |
| Android Native and Windows Desktop | Locally installed; API upstream depends on server availability | Validate settings for alternate backend and signed update/rollback, no untested auto-switch |
| Website + downloads `.com` | Linked to inaccessible older Vercel project | Verify ownership, repo/build portability, DNS and immutable APK storage |
| HR Cpi-Attendance | Separate code, schema and runtime | Independent cloud build, auth and time-clock test |
| Supabase transactional database | Two live projects seen; backup status unverified | Independent PITR/backup + restore test, RLS and privilege checks |
| Payments/webhooks/printing | Must preserve exact-once operations | Re-register callback targets where required; replay/idempotency and printer ACK tests |

## Rehearsal phases (NO automatic cutover before full acceptance)

**0. Prevent an accidental mixed-host deployment**. Keep production DNS, payment callbacks, GitHub secrets and Supabase untouched. Leave Cloudflare status Worker as an independent incident notice. Do not host a second writable production POS while transaction ordering, tenant auth and print claims are unproven.

**1. Pro restoration verification**. Run `node scripts/dr/public-readiness.mjs` or GitHub Action `CpiPOS Vercel Pro / Cloudflare DR read-only verification`. This is **only** public GET availability and must not use real store codes.

**2. Cloudflare POS staging**. Use the existing `Cloudflare DR` workflow action `deploy-pos-staging` with `TEST-ONLY` and dedicated non-production Supabase keys. Required *secret names*: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CPI_DR_TEST_SUPABASE_URL`, `CPI_DR_TEST_SUPABASE_ANON_KEY`, `CPI_DR_TEST_SUPABASE_SERVICE_ROLE_KEY`, `CPI_DR_TEST_POS_SESSION_HANDOFF_SECRET`. Do **not** use production credentials or copy production customer data. Secrets may be added by owner in GitHub UI. This workflow has not been run on live Cloudflare POS yet.

**3. Acceptance gate**. With synthetic test tenant only, prove (a) auth and cross-tenant isolation; (b) stock/catalog/cart; (c) table and takeaway submission + kitchen ACK/lock; (d) QR and exact-once payment/replay; (e) 58/80 mm print, duplicate print lock and shift open-close; (f) MDM and device heartbeat; (g) Android/Windows API URL migration; (h) session renewal, cookies, security headers and rate limits; (i) production-equivalent workload with Workers CPU, bundle/startup/timeouts; (j) explicit rollback drill. Do not claim zero data loss based on a simple 200 response.

**4. Manual incident failover only**. During a future Vercel failure, incident commander checks *independent* Cloudflare backend health plus Supabase health, runs transactional smoke tests and confirms required DNS/API host mapping. Obtain explicit human approval to switch named routes only after safe deployment and rollback criteria. Restore Vercel only after idempotent reconciliation of orders, payments and print claims.

**5. Expand to other services**. HR, company downloads and IT have separate acceptance tracks. Do not equate the POS Worker build with those projects being backed up.

## Cost and CPU risk
Cloudflare Workers Free currently allows 100,000 requests/day and 10 ms CPU/request. CPU-heavy Next.js SSR/auth can exceed that even if the compiled Worker fits within 64 MiB. Verify the Free plan under real test load; do **not** upgrade, incur a new paid resource, or claim reliable hot standby without approval. Never introduce Cloudflare "Cache Everything" for authenticated routes or payment APIs.

## Security / operations
- Keep separate test and production database secrets; no values in GitHub source, PR messages, logs or chat.
- Worker statics use `no-store` and expose no credentials. Production routes stay Vercel until an approved switch.
- Public availability probe uses only anonymous GETs; a success means public endpoints responded, **not** overall system health.
- A GitHub Actions workflow on a timed schedule can use CI minutes; the manual-only workflow avoids adding recurring usage until an operator approves a cadence.
- Once real standby is ready, record actual Worker hostname, deployment SHA, tested rollback, alert recipients, DNS TTL, RPO, RTO and last rehearsal date.

## Primary references
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- https://vercel.com/docs/plans/pro-plan
