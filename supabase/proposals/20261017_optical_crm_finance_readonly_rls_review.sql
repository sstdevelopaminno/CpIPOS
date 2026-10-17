-- PROPOSED ONLY: not applied to production until transactional migration verification.
-- Add read-only Optical finance access for the owner/manager CRM screen.
-- It is still explicitly controlled by the IT CUSTOM Optical entitlement.
create or replace function app.custom_optical_finance_read_enabled(p_tenant_id uuid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public,app
as $function$
 select (select count(*) from public.tenant_subscription_contracts c
         where c.tenant_id=p_tenant_id and c.status in ('active','trial')
           and (c.ended_at is null or c.ended_at>now()))=1
   and exists(
      select 1 from public.tenant_subscription_contracts c
      join public.subscription_packages p on p.id=c.package_id
      where c.tenant_id=p_tenant_id and c.status in ('active','trial')
        and (c.ended_at is null or c.ended_at>now())
        and lower(p.code)='custom'
        and c.metadata->'sales_modes'->>'optical_retail'='true'
        and c.metadata->'custom_features'->>'optical_work_orders'='true'
   );
$function$;
revoke all on function app.custom_optical_finance_read_enabled(uuid) from public,anon;
grant execute on function app.custom_optical_finance_read_enabled(uuid) to authenticated,service_role;

do $policy$
declare name text;
begin
 foreach name in array array['optical_work_orders','optical_work_order_lines',
   'optical_stock_reservations','optical_payment_ledger','optical_work_order_events'] loop
   execute format('alter table public.%I enable row level security',name);
   execute format('revoke all on public.%I from public,anon,authenticated',name);
   execute format('grant select on public.%I to authenticated',name);
   if not exists(select 1 from pg_policies where schemaname='public'
                 and tablename=name and policyname=name||'_crm_read_v1') then
     execute format('create policy %I on public.%I for select to authenticated using (public.can_manage_optical_customer_data(tenant_id,branch_id) and app.custom_optical_finance_read_enabled(tenant_id))',
                    name||'_crm_read_v1',name);
   end if;
 end loop;
end;
$policy$;
-- NEVER grant browser write rights to the finance ledger. Cash mutations are
-- service-role only through idempotent Optical RPC + POS-session/shift/IT guard.
