-- STAGED ONLY / NEVER APPLY TO LIVE WITHOUT ISOLATED DEV RLS + LOGIN E2E.
-- CRM staff is opt-in at IT package level; permissions are issued by the tenant Owner.
-- This migration leaves POS Starter/Growth/Business and non-Optical modes unchanged.
begin;

create table if not exists public.tenant_crm_employee_permissions (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  menu_key text not null check (menu_key in (
    'main.crm_optical_customers','main.crm_optical_orders'
  )),
  can_view boolean not null default false,
  can_edit boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant_id,branch_id,user_id,menu_key),
  constraint tenant_crm_can_edit_requires_view check (not can_edit or can_view)
);
alter table public.tenant_crm_employee_permissions enable row level security;
revoke all on public.tenant_crm_employee_permissions from public, anon, authenticated;
grant select on public.tenant_crm_employee_permissions to authenticated;
create policy tenant_crm_employee_permissions_read_v1
  on public.tenant_crm_employee_permissions for select to authenticated using (
    (select auth.uid())=user_id
    or exists (
      select 1 from public.user_branch_roles r
      where r.tenant_id=tenant_crm_employee_permissions.tenant_id
        and r.user_id=(select auth.uid()) and r.role::text='owner'
    )
  );

-- Internal predicate: never exposed as a Data API RPC.
create or replace function app.crm_staff_permission_allowed(
  p_tenant uuid,p_branch uuid,p_menu text,p_need_edit boolean default false
) returns boolean language sql stable security definer
set search_path to 'pg_catalog','public','app' as $fn$
  select auth.uid() is not null
    and p_menu in ('main.crm_optical_customers','main.crm_optical_orders')
    and exists(select 1 from public.users_profiles u where u.id=auth.uid()
      and u.is_active=true and u.archived_at is null)
    and exists(select 1 from public.user_branch_roles r
      where r.tenant_id=p_tenant and r.branch_id=p_branch
        and r.user_id=auth.uid() and r.role::text='staff')
    and exists(select 1 from public.tenant_pos_menu_policies p
      where p.tenant_id=p_tenant and p.menu_key='settings.crm_access_staff'
        and p.is_enabled=true)
    and not exists(select 1 from public.tenant_pos_menu_policies p
      where p.tenant_id=p_tenant and p.menu_key in ('main.crm_optical',p_menu)
        and p.is_enabled=false)
    and exists(select 1 from public.tenant_crm_employee_permissions g
      where g.tenant_id=p_tenant and g.branch_id=p_branch and g.user_id=auth.uid()
        and g.menu_key=p_menu and g.can_view=true
        and (not p_need_edit or g.can_edit=true))
    and exists(select 1 from public.tenant_subscription_contracts c
      join public.subscription_packages pkg on pkg.id=c.package_id
      where c.tenant_id=p_tenant and c.status in ('active','trial')
        and (c.ended_at is null or c.ended_at>now())
        and lower(pkg.code)='custom'
        and c.metadata->'sales_modes'->>'optical_retail'='true');
$fn$;
revoke all on function app.crm_staff_permission_allowed(uuid,uuid,text,boolean) from public, anon;
grant execute on function app.crm_staff_permission_allowed(uuid,uuid,text,boolean) to authenticated;

create table if not exists public.tenant_crm_permission_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  menu_key text not null,
  previous_view boolean,
  previous_edit boolean,
  next_view boolean not null,
  next_edit boolean not null,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.tenant_crm_permission_events enable row level security;
revoke all on public.tenant_crm_permission_events from public, anon, authenticated;
grant select on public.tenant_crm_permission_events to authenticated;
create policy tenant_crm_permission_events_owner_read_v1
  on public.tenant_crm_permission_events for select to authenticated using (
    exists(select 1 from public.user_branch_roles r
      where r.tenant_id=tenant_crm_permission_events.tenant_id
        and r.user_id=(select auth.uid()) and r.role::text='owner')
  );

create or replace function public.customer_portal_set_staff_crm_permission_v1(
  p_tenant_id uuid,p_branch_id uuid,p_user_id uuid,p_menu_key text,
  p_can_view boolean,p_can_edit boolean
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','app' as $fn$
declare v_before public.tenant_crm_employee_permissions%rowtype;
begin
  if auth.uid() is null then raise exception 'crm_auth_required' using errcode='42501'; end if;
  if p_user_id is null or p_tenant_id is null or p_branch_id is null
     or p_menu_key not in ('main.crm_optical_customers','main.crm_optical_orders')
     or p_can_view is null or p_can_edit is null or (p_can_edit and not p_can_view)
  then raise exception 'crm_permission_invalid' using errcode='22023'; end if;
  if not exists(select 1 from public.user_branch_roles r
      join public.users_profiles u on u.id=r.user_id
      where r.user_id=auth.uid() and r.tenant_id=p_tenant_id
        and r.role::text='owner' and u.is_active and u.archived_at is null)
  then raise exception 'crm_owner_required' using errcode='42501'; end if;
  if not exists(select 1 from public.user_branch_roles r
      join public.users_profiles u on u.id=r.user_id
      join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id and b.is_active
      where r.user_id=p_user_id and r.tenant_id=p_tenant_id and r.branch_id=p_branch_id
        and r.role::text='staff' and u.is_active and u.archived_at is null)
  then raise exception 'crm_target_staff_required' using errcode='42501'; end if;
  select * into v_before from public.tenant_crm_employee_permissions g
    where g.tenant_id=p_tenant_id and g.branch_id=p_branch_id
      and g.user_id=p_user_id and g.menu_key=p_menu_key for update;
  insert into public.tenant_crm_employee_permissions (
    tenant_id,branch_id,user_id,menu_key,can_view,can_edit,updated_by,updated_at
  ) values (p_tenant_id,p_branch_id,p_user_id,p_menu_key,p_can_view,p_can_edit,auth.uid(),now())
  on conflict (tenant_id,branch_id,user_id,menu_key)
  do update set can_view=excluded.can_view,can_edit=excluded.can_edit,
    updated_by=excluded.updated_by,updated_at=now();
  insert into public.tenant_crm_permission_events(
    tenant_id,branch_id,user_id,menu_key,previous_view,previous_edit,next_view,next_edit,actor_id
  ) values(p_tenant_id,p_branch_id,p_user_id,p_menu_key,
    v_before.can_view,v_before.can_edit,p_can_view,p_can_edit,auth.uid());
  return jsonb_build_object('menu_key',p_menu_key,'can_view',p_can_view,'can_edit',p_can_edit);
end;
$fn$;
revoke all on function public.customer_portal_set_staff_crm_permission_v1(uuid,uuid,uuid,text,boolean,boolean) from public, anon;
grant execute on function public.customer_portal_set_staff_crm_permission_v1(uuid,uuid,uuid,text,boolean,boolean) to authenticated;

create or replace function public.customer_portal_staff_crm_permissions_v1(
  p_tenant_id uuid,p_branch_id uuid,p_user_id uuid
) returns table(menu_key text,can_view boolean,can_edit boolean)
language plpgsql stable security definer
set search_path to 'pg_catalog','public','app' as $fn$
begin
  if auth.uid() is null then raise exception 'crm_auth_required' using errcode='42501'; end if;
  if p_user_id<>auth.uid() and not exists(
    select 1 from public.user_branch_roles r
    where r.user_id=auth.uid() and r.tenant_id=p_tenant_id and r.role::text='owner'
  ) then raise exception 'crm_owner_required' using errcode='42501'; end if;
  if not exists(select 1 from public.user_branch_roles r
      where r.user_id=p_user_id and r.tenant_id=p_tenant_id and r.branch_id=p_branch_id
  ) then raise exception 'crm_staff_scope_denied' using errcode='42501'; end if;
  return query select p.menu_key,p.can_view,p.can_edit
    from public.tenant_crm_employee_permissions p
    where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id and p.user_id=p_user_id;
end;
$fn$;
revoke all on function public.customer_portal_staff_crm_permissions_v1(uuid,uuid,uuid) from public, anon;
grant execute on function public.customer_portal_staff_crm_permissions_v1(uuid,uuid,uuid) to authenticated;

-- Staff's feature-state RPC is deliberately limited to Optical read-only menus.
-- It MUST NOT grant access to dashboard, POS finance, staff admin or package settings.
create or replace function public.customer_portal_staff_feature_state_v1(
  p_tenant_id uuid,p_branch_id uuid
) returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog','public','app' as $fn$
declare v_custom boolean := false;
declare v_currency text := null;
declare v_package uuid;
declare v_customers boolean := false;
declare v_orders boolean := false;
begin
  if auth.uid() is null or p_branch_id is null then
    raise exception 'crm_staff_scope_required' using errcode='42501';
  end if;
  v_customers := app.crm_staff_permission_allowed(p_tenant_id,p_branch_id,'main.crm_optical_customers',false);
  v_orders := app.crm_staff_permission_allowed(p_tenant_id,p_branch_id,'main.crm_optical_orders',false);
  if not v_customers and not v_orders then
    raise exception 'crm_staff_access_disabled' using errcode='42501';
  end if;
  select c.package_id, (lower(pkg.code)='custom'),c.metadata->>'pos_currency_code'
    into v_package,v_custom,v_currency
    from public.tenant_subscription_contracts c
    join public.subscription_packages pkg on pkg.id=c.package_id
    where c.tenant_id=p_tenant_id and c.status in('active','trial')
      and (c.ended_at is null or c.ended_at>now())
      and c.metadata->'sales_modes'->>'optical_retail'='true'
    order by c.created_at desc limit 1;
  if not coalesce(v_custom,false) then raise exception 'crm_staff_package_denied' using errcode='42501'; end if;
  return jsonb_build_object(
    'package_id',v_package,
    'is_custom',true,'is_internal_test_full',false,
    'optical_retail_enabled',true,
    'sales_modes',jsonb_build_object('optical_retail',true),
    'sales_currency_code',case when v_currency in('THB','LAK','USD') then v_currency else null end,
    'package_features','{}'::jsonb,'feature_overrides','{}'::jsonb,
    'menu_policy',jsonb_build_object(
      'main.crm_overview',false,'main.crm_sales',false,
      'main.crm_products',false,'main.crm_stock',false,
      'main.crm_staff',false,'main.crm_package',false,
      'main.crm_more',false,'main.crm_settings',false,
      'main.crm_optical',v_customers or v_orders,
      'main.crm_optical_customers',v_customers,
      'main.crm_optical_orders',v_orders,
      'main.crm_optical_stock',false,
      'main.crm_optical_reports',false)
  );
end;
$fn$;
revoke all on function public.customer_portal_staff_feature_state_v1(uuid,uuid) from public, anon;
grant execute on function public.customer_portal_staff_feature_state_v1(uuid,uuid) to authenticated;

-- Preserve existing hardened rate-limit and magic-link employee authentication.
-- Only change eligibility: Owner always; Manager unless IT opts out;
-- Staff ONLY when IT explicitly enables access and Owner granted a scoped menu.
CREATE OR REPLACE FUNCTION public.customer_portal_authenticate_employee(p_store_code text, p_employee_code text, p_client_key text)
 RETURNS TABLE(user_id uuid, email text, tenant_id uuid, tenant_code text, tenant_name text, portal_role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_store_code text := trim(coalesce(p_store_code, ''));
  v_employee_code text := trim(coalesce(p_employee_code, ''));
  v_client_key text := trim(coalesce(p_client_key, ''));
  v_failures integer := 0;
  v_candidate record;
begin
  if v_store_code !~ '^[A-Za-z0-9_-]{3,32}$' then
    raise exception using errcode='22023', message='invalid_store_code';
  end if;

  if v_employee_code !~ '^[A-Za-z0-9._-]{2,32}$' then
    raise exception using errcode='22023', message='invalid_employee_code';
  end if;

  if length(v_client_key) < 16 or length(v_client_key) > 128 then
    raise exception using errcode='22023', message='invalid_client_key';
  end if;

  delete from app.customer_portal_login_attempts
   where attempted_at < now() - interval '24 hours';

  select count(*)
    into v_failures
    from app.customer_portal_login_attempts
   where store_code = v_store_code
     and client_key = v_client_key
     and success = false
     and attempted_at >= now() - interval '15 minutes';

  if v_failures >= 5 then
    raise exception using errcode='P0001', message='portal_rate_limited';
  end if;

  select
    up.id as user_id,
    au.email::text as email,
    t.id as tenant_id,
    tac.access_code::text as tenant_code,
    coalesce(nullif(t.display_name, ''), t.name)::text as tenant_name,
    ubr.role::text as portal_role
  into v_candidate
  from public.tenant_access_codes tac
  join public.tenants t
    on t.id = tac.tenant_id
   and t.is_active = true
  join public.user_branch_roles ubr
    on ubr.tenant_id = t.id
   and ubr.role::text in ('owner', 'manager', 'staff')
  join public.users_profiles up
    on up.id = ubr.user_id
   and up.is_active = true
   and up.archived_at is null
  join public.pos_user_profiles pup
    on pup.user_id = up.id
   and pup.tenant_id = t.id
  join auth.users au
    on au.id = up.id
   and au.deleted_at is null
  where tac.access_code = v_store_code
    and tac.is_active = true
    and btrim(pup.employee_code) = v_employee_code
    and (
      ubr.role::text = 'owner'
      or (ubr.role::text = 'manager' and coalesce((
        select policy.is_enabled from public.tenant_pos_menu_policies policy
        where policy.tenant_id=t.id and policy.menu_key='settings.crm_access_manager'
      ),true))
      or (
        ubr.role::text = 'staff'
        and exists(select 1 from public.tenant_pos_menu_policies policy
          where policy.tenant_id=t.id and policy.menu_key='settings.crm_access_staff'
          and policy.is_enabled=true)
        and exists(select 1 from public.tenant_crm_employee_permissions perm
          where perm.tenant_id=t.id and perm.branch_id=ubr.branch_id
            and perm.user_id=up.id and perm.can_view
            and perm.menu_key in ('main.crm_optical_customers','main.crm_optical_orders'))
        and exists(select 1 from public.tenant_subscription_contracts c
          join public.subscription_packages pkg on pkg.id=c.package_id
          where c.tenant_id=t.id and c.status in ('active','trial')
            and (c.ended_at is null or c.ended_at>now())
            and lower(pkg.code)='custom'
            and c.metadata->'sales_modes'->>'optical_retail'='true')
      )
    )
  order by
    case when ubr.role::text = 'owner' then 0 else 1 end,
    case when ubr.is_default then 0 else 1 end,
    up.created_at
  limit 1;

  if not found then
    insert into app.customer_portal_login_attempts(store_code, client_key, success)
    values (v_store_code, v_client_key, false);
    return;
  end if;

  insert into app.customer_portal_login_attempts(store_code, client_key, success)
  values (v_store_code, v_client_key, true);

  delete from app.customer_portal_login_attempts
   where store_code = v_store_code
     and client_key = v_client_key
     and success = false;

  return query
  select
    v_candidate.user_id::uuid,
    v_candidate.email::text,
    v_candidate.tenant_id::uuid,
    v_candidate.tenant_code::text,
    v_candidate.tenant_name::text,
    v_candidate.portal_role::text;
end;
$function$;
revoke all on function public.customer_portal_authenticate_employee(text,text,text) from public, anon;
grant execute on function public.customer_portal_authenticate_employee(text,text,text) to service_role;

-- Staff can READ only the Optical tables for their expressly granted menu.
-- No staff DML permission is created here. Writes need a separate reviewed RPC.
create policy optical_customers_crm_staff_read_v1
  on public.optical_customers for select to authenticated using (
    app.crm_staff_permission_allowed(tenant_id,branch_id,'main.crm_optical_customers',false)
  );
create policy optical_eye_exams_crm_staff_read_v1
  on public.optical_eye_exams for select to authenticated using (
    app.crm_staff_permission_allowed(tenant_id,branch_id,'main.crm_optical_customers',false)
  );
create policy optical_work_orders_crm_staff_read_v1
  on public.optical_work_orders for select to authenticated using (
    app.crm_staff_permission_allowed(tenant_id,branch_id,'main.crm_optical_orders',false)
  );
create policy optical_work_order_lines_crm_staff_read_v1
  on public.optical_work_order_lines for select to authenticated using (
    app.crm_staff_permission_allowed(tenant_id,branch_id,'main.crm_optical_orders',false)
  );

commit;
