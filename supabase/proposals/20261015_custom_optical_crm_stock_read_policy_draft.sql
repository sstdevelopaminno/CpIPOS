-- DRAFT ONLY / NOT APPLIED TO PRODUCTION
-- CRM Optical stock tables require authenticated, scoped read access to
-- optical_stock_bins. The table currently has RLS enabled and zero policies.
-- Do not expose inventory bins to all authenticated accounts or food tenants.
create or replace function app.custom_optical_stock_read_enabled(p_tenant_id uuid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public,app
as $$
 select exists(
   select 1 from public.tenant_subscription_contracts c
   join public.subscription_packages p on p.id=c.package_id
   where c.tenant_id=p_tenant_id
     and c.status in ('active','trial')
     and (c.ended_at is null or c.ended_at>now())
     and lower(p.code)='custom'
     and c.metadata->'sales_modes'->>'optical_retail'='true'
 );
$$;
revoke all on function app.custom_optical_stock_read_enabled(uuid) from public,anon;
grant execute on function app.custom_optical_stock_read_enabled(uuid) to authenticated;
-- Branch access and plan entitlement BOTH required.
create policy custom_optical_stock_bins_select_v1
on public.optical_stock_bins for select to authenticated
using(
  app.has_branch_access(tenant_id,branch_id)
  and app.custom_optical_stock_read_enabled(tenant_id)
);
grant select on public.optical_stock_bins to authenticated;

-- Safety verification before promotion:
-- - Authenticated CUSTOM Optical owner/manager sees only authorized branches.
-- - Authenticated normal food / CUSTOM without optical flag sees zero bins.
-- - Anonymous users cannot read rows.
-- - No INSERT/UPDATE/DELETE grant added.
-- - Apply only after PR #276 cutover, review RLS assumptions and test with
--   actual CRM auth tokens against a disposable database.
