# AI Guardrails For CpIPOS

Date: 2026-08-08

## Current Project

- Active local workspace: `E:\CpIPOS`
- Active GitHub repo: `https://github.com/sstdevelopaminno/CpIPOS.git`
- Active branch: `agent-docs-preflight-schema-drift`
- Active Vercel project: `cp-ipos-web`
- Active production URL: `https://cp-ipos-web.vercel.app`
- Active Supabase project: `POS-Preview`
- Active Supabase ref: `deejlitaivfnsbwqdugy`
- Latest handoff: `docs/CPIPOS-HANDOFF-2026-07-28.md`
- Current collaboration preference: token-saving mode; wait for explicit user instructions before further development.

## Do Not Confuse With Old Project

- Do not develop new Web POS work from `E:\SSTiPOS`.
- Do not push new CpIPOS work to `sstdevelopaminno/SSTiPOS.git`.
- Do not create parallel worktrees or sibling copies unless the user explicitly requests it.
- Use `E:\CpIPOS` as the single source of truth for the new CpIPOS Web POS.

## Production Database Baseline

Production business data is intentionally limited to these tenant/store codes:

- `NDL-TH-001`
- `BBQ-TH-002`
- `TEST-TH-003`

Rules:

- `SOLO-TH-001` was removed from Production on 2026-08-07 and must not be re-seeded.
- Package code `solo` / `Solo Register` is a valid system package and is not a tenant/store code; keep the package catalog entry.
- The default `supabase/seed.sql` must remain tenant-neutral. Do not hard-code production/demo tenants, branches, devices, users, passwords, PINs, orders, products, or inventory into the default reset path.
- Temporary demo fixtures, if ever needed, must be explicit opt-in scripts and must not reuse production store codes or credentials.
- Do not rename live tables, columns, constraints, RPCs, or RLS policies merely for style. Use additive compatibility-safe migrations and verify runtime consumers first.
- Database housekeeping migrations `20260807152000`, `20260807154613`, `20260807155636`, `20260807155747`, `20260807155904`, and `20260807164920` are the current Production-safe baseline.
- Privileged `public` `SECURITY DEFINER` RPCs used by POS/Web/Mobile server paths must remain non-executable by `anon` and `authenticated`; trusted server callers use `service_role`.
- Policies that call authenticated-only helper functions such as `app.has_branch_access`, `app.has_role`, or `app.is_it_admin` must not be restored to `TO public`; use an explicitly authenticated target unless a separately reviewed anonymous contract exists.
- Do not add RLS policies to server-only tables merely to silence `RLS Enabled No Policy` Advisor notices. RLS with no policy is intentionally deny-by-default unless a direct-client access contract is explicitly designed.
- Do not remove an index solely because Supabase marks it unused; require a meaningful Production observation window and workload evidence first.
- Supabase Auth `Leaked Password Protection` should be enabled in project Auth Settings before customer onboarding; it is a project-level Auth setting, not a SQL migration.

## Required Production Env

Vercel production must include these server/runtime variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POS_SESSION_HANDOFF_SECRET`
- `TABLE_QR_SIGNING_SECRET`

`POS_SESSION_HANDOFF_SECRET` is required for valid store-code login because the server signs the pre-entry login-flow cookie after tenant and branch lookup.
`TABLE_QR_SIGNING_SECRET` must be separate from `SUPABASE_SERVICE_ROLE_KEY`; table QR tokens must not be signed with service-role credentials.

Production/serverless auth rate limiting should use the distributed Upstash backend (`RATE_LIMIT_BACKEND=upstash` with valid `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`). In-memory limiting is process-local and is only an acceptable local/degraded fallback.

## Transaction And API Reliability Rules

- Production order creation and payment completion are transaction-RPC first. Keep `POS_FORCE_DIRECT_CREATE_NON_DELIVERY=false` and `POS_FORCE_DIRECT_PAYMENT_COMPLETE=false` unless an explicitly reviewed emergency compatibility rollback requires otherwise.
- Keep `POS_SOFT_BYPASS_INSUFFICIENT_STOCK=false` by default. Negative-stock behavior must come from the branch-aware database policy, not a generic application bypass.
- Direct multi-request order/payment fallbacks are not atomic and must never become the silent default again.
- A timeout implemented around a Supabase promise does not prove the database mutation was cancelled. After a timeout, retry a mutation only with the same idempotency/request key so a late first attempt cannot duplicate an order or payment.
- Do not introduce internal HTTP calls from one Next.js route to another route in the same deployment when the canonical handler/service can be invoked in-process.
- External API calls must have a bounded timeout and must not retry money-changing operations automatically unless the provider contract and idempotency semantics explicitly make the retry safe.
- Provider-supplied outbound URLs must be validated before server-side fetch. For INET NOPS, dynamic payment URLs must use HTTPS and an approved provider hostname (configured endpoint host or explicit `INET_NOPS_ALLOWED_PAYMENT_HOSTS_*`).
- Do not expose service-role credentials, provider merchant keys, access tokens, or raw provider error bodies to browser responses or logs.

## Verified Login Store Codes

These store codes are the current Production business baseline:

- `NDL-TH-001`: valid production tenant
- `BBQ-TH-002`: valid production tenant
- `TEST-TH-003`: valid production test/trial tenant
- `ABC999`: expected fake code; must return `404 store_not_found`

## Production Smoke Expectations

- `/login/store`: `200`
- `/login/branches`: `200`
- `/login/employee`: `200`
- `/login/devices`: `200`
- `/manifest.webmanifest`: `200`
- `/preview/pos`: redirects to `/login/store` without a POS session
- `/preview/pos/settings`: redirects to `/login/store` without a POS session
- `/api/pos/session/current`: `401 missing_pos_session` without login
- `/api/pos/features`: `401 missing_pos_session` without login
- `/api/pos/sales`: `401 missing_pos_session` without login

## Security Rules

- Never commit `.vercel/`, `.env.local`, Vercel tokens, Supabase access tokens, database passwords, service-role keys, or generated local cache folders.
- Keep Supabase service-role usage server-only.
- Never restore direct `anon`/`authenticated` EXECUTE on privileged POS transaction wrappers without a separately reviewed direct-client security design.
- If valid store-code login returns `500`, first check Vercel env for `POS_SESSION_HANDOFF_SECRET` before changing database schema.
- For local `localhost:3000` login slowness or API timeouts, read `docs/LOCAL-DEV-LOGIN-PERFORMANCE-2026-07-27.md` before debugging. Most local delays are first-route compile, missing `.env.local`, sandboxed network, or slow `.next/dev` filesystem cache.