# CpiPOS DR — cost-free ephemeral Supabase local schema check

**Scope**: transient Dockerized Supabase stack on GitHub-hosted runner only. This does not create a cloud project or branch, cannot be used from Cloudflare Workers online, and is not a copy of the production data plane.

## Context
- Owner has upgraded Vercel primary to Pro and wants Cloudflare as full emergency standby.
- Supabase organization is Free with 2 active projects already, equal to the free-project quota (see https://supabase.com/docs/guides/platform/billing-on-supabase).
- Cost query on the connected organization returned `project: $0/mo`, but adding a third free project exceeds the current two-project allowance. A development branch returned `$0.01344/hour`; this **was not authorized or created**.
- Repository already contains 200+ Supabase SQL migrations plus a **tenant-neutral** default `supabase/seed.sql` (no production customer data).

## What the workflow does
Workflow `.github/workflows/dr-local-supabase.yml` starts a short-lived local Supabase stack with Docker on a GitHub runner, runs repository migrations, checks that `public.tenants` exists, `public.tenants` RLS is enabled and the **default** seed creates zero tenant rows, then stops the containers. It does **not** connect or write to either production Supabase project.

GitHub Actions runner minutes and hosted CI quotas may apply; do not interpret this workflow as offering unlimited free compute. It is manual / PR-scoped and has no recurring schedule.

## Verification
When this workflow passes it means a local migration baseline can boot without additional hosted Supabase capacity. It does not establish application auth, payment safety, POS order/print transaction correctness or RTO/RPO.

Do not point Cloudflare staging Workers to `localhost:54321` in a GitHub runner: the service disappears after the job. For live Cloudflare staging, an independently provisioned hosted test Supabase instance remains necessary, or a different intentionally isolated test environment publicly reachable from Cloudflare with appropriate security constraints.

## Next acceptance steps
1. Resolve any local migration drift without touching production.
2. Use synthetic test tenants and POS integration checks in this same ephemeral local environment; never copy customer codes, PINs or data.
3. When a hosted stage data plane is funded/available, configure only the `CPI_DR_TEST_*` secrets in GitHub; **never** production keys.
4. Deploy `cpi-pos-standby-stage` on Cloudflare Free, review worker CPU time (Free: 10ms/request) and certify tenant-auth, order, kitchen, payment, receipt, MDM, and Android/Windows API failover before changing customer traffic.

No Vercel DNS, production Supabase, Cloudflare plan, customer deployment or payment callback is modified by this workflow.
