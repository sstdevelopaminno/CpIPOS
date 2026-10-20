# CpiPOS Production Guardrails — 20 October 2026

## Verified scope
- GitHub: `sstdevelopaminno/CpIPOS`; Production release `main`.
- Vercel Production `cp-ipos-web` served commit `c81d0ad2456fe12c14900593f81287999a988e0e` as of the inspection. A READY deployment/green CI does not replace authenticated POS UAT.
- CpiPOS-001 only was available via connected Supabase. Trial data-plane CpiPOS-002 could not be inspected via connected permissions; never assume it matches CpiPOS-001.
- The inspection and additive privilege fix did not change customer subscriptions, ledger, stock, print jobs or printer profiles.
- Read-only global version comparison: 222 repository .sql migration files vs 312 applied live history entries, 129 matching version IDs, 93 repository-only version IDs and 183 database-only version IDs. Differences extend well beyond the two Optical migrations. This is a **global release/migration reconciliation BLOCKER**, not evidence that all 276 unmatched migrations need to run or that any tables are missing. Do not automatically run `db push` against production or alter `supabase_migrations.schema_migrations` to make the counts green.

## 1. Security advisory triage
- Prior to this fix: 1 anon-executable SECURITY DEFINER Optical trigger helper, 30 authenticated-executable SECURITY DEFINER functions, 1 leaked-password-protection configuration warning, 103 RLS-on/no-policy INFO findings.
- Live: the trigger helper `public.optical_assign_document_number_after_insert_v1()` was granted EXECUTE to PUBLIC/anon/authenticated, though it is a `RETURNS trigger` function intended only for the two Optical insert triggers.
- Applied on CpiPOS-001 via the reviewed Supabase migration name `restrict_optical_document_trigger_exec_20261020` (live migration history version `20261020112455`). Verified `has_function_privilege(anon)` and `has_function_privilege(authenticated)` FALSE, `service_role` TRUE, and both trigger records enabled.
- The checked remaining privileged routines include tenant-authorization helper calls, but do NOT blanket-revoke them: existing CRM/Optical authenticated RPC flows depend on them. Each function needs an authenticated wrong-tenant/role test and review before modifications.
- RLS-enabled/no-policy tables default to deny rows even when relation-level SELECT is granted. Read grants alone are not evidence of exposed rows. Do not auto-open policies.
- Password breach protection requires an explicit Auth configuration change with release notes / onboarding regression; investigate with the Supabase Auth administrator.
- Security advisor remediation: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable and https://supabase.com/docs/guides/auth/password-security

## 2. Default branch discrepancy
- GitHub default branch `agent-docs-preflight-schema-drift` is not the active deployment branch `main`.
- Comparative review: `main` has 228 exclusive commits; the old default has one exclusive commit in `.github/workflows/promote-existing-vercel-production.yml`. Current file contents are identical across both refs, so the old branch commit is not a unique unported workflow implementation.
- Unmerged PR #257 has `head=main`, `base=agent-docs-preflight-schema-drift`: DO NOT merge it as routine delivery or force-push an old branch.
- Recommended repository default branch: `main` **after checking repository settings, open PR automation and Vercel build branch configuration**. Native GitHub connector does not expose the repo default-branch admin PATCH; this cannot be represented as a source-code-only PR.

## 3. Migration provenance / no replay
Supabase migration history versions and source filenames differ for the optical documents:
| Live migration history | Main source migration |
| --- | --- |
| `20261020084159` `optical_stable_document_numbers_v1_20261020` | `20261020200000_optical_stable_document_numbers_v1.sql` |
| `20261020084205` `optical_printer_work_order_purpose_20261020` | `20261020201000_optical_printer_work_order_purpose.sql` |
| `20261020112455` `restrict_optical_document_trigger_exec_20261020` | `20261020202000_restrict_optical_document_trigger_exec.sql` |

Existing live tables/functions/triggers/constraint were verified by catalog checks. This table is **a provenance mapping, not a license to mark a migration complete or to rerun it**. Before applying source migrations to CpiPOS-001, compare the complete SQL/function definitions and history with the migration tooling; never rewrite live migration history or replay historical backfills on customer records blindly.

## 4. Production final acceptance (NOT yet certified)
- Signed-in UAT: active paid Growth/other fixed plans can enter cashier and sell; expired trial shows truthful localized Thai/Lao/English popup before opening device; access gate fails closed only on actual entitlement failure.
- CUSTOM Optical UAT: document numbers unique in branch, existing docs intact; 80mm deposit print + manager PIN + printer purpose; approved CUSTOM-only menus enforced on server and client, no visibility across tenants.
- Financial UAT: cash, transfer, partial deposits, refund/void, shift closure, duplicate retry, stock decrement once, receipt reprint and historical money immutable. THB/LAK/USD phase-2 is NOT declared complete.
- Hardware UAT: real kitchen-capable physical printer profile, print ACK/dedup, Android device pairing and update; don't blindly resend historical print jobs.
- Release gates: checked preview/production SHA, authenticated tests, actual hardware signoff, live logs within permitted retention, no 5xx/error cluster.
- Related open trackers: #153 production stabilization, #74 kitchen physical acceptance, #261 Optical rollout, #274 global currency. These remain OPEN until physical and authenticated UAT evidence exists.

## Commands for safe post-change revalidation
```sql
select has_function_privilege('anon','public.optical_assign_document_number_after_insert_v1()','EXECUTE') as anon_allowed,
       has_function_privilege('authenticated','public.optical_assign_document_number_after_insert_v1()','EXECUTE') as staff_allowed,
       has_function_privilege('service_role','public.optical_assign_document_number_after_insert_v1()','EXECUTE') as service_allowed;
select tgname,tgenabled from pg_trigger where tgname in (
  'optical_work_order_number_after_insert_v1', 'optical_payment_number_after_insert_v1');
```
