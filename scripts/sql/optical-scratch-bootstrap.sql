-- Synthetic ONLY: GitHub Actions postgres service, never run on CpiPOS Production.
\set ON_ERROR_STOP on
create extension if not exists pgcrypto;
create schema if not exists app;
create schema if not exists auth;
do $roles$
begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end
$roles$;
grant usage on schema public,app to anon,authenticated,service_role;
grant usage on schema auth to authenticated,service_role;
create function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
  $$;
grant execute on function auth.uid() to authenticated,service_role;

create table public.tenants(id uuid primary key,code text not null);
create table public.branches(id uuid primary key,tenant_id uuid not null references public.tenants(id),name text);
create table public.products(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null references public.branches(id),
 sku text not null,name text not null,price numeric not null,
 stock_deduction_mode text not null default 'unit_only',
 is_active boolean not null default true,deleted_at timestamptz
);
create table public.users_profiles(
 id uuid primary key, is_active boolean not null default true,archived_at timestamptz
);
create table public.user_branch_roles(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.users_profiles(id),
 tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null references public.branches(id),role text not null
);
create table public.subscription_packages(id uuid primary key,code text not null);
create table public.tenant_subscription_contracts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 package_id uuid not null references public.subscription_packages(id),
 status text not null,ended_at timestamptz,
 metadata jsonb not null default '{}'::jsonb
);
create table public.optical_customers(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null references public.branches(id),
 full_name text not null,deleted_at timestamptz,updated_at timestamptz default now(),updated_by uuid
);
create table public.optical_eye_exams(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null references public.branches(id),customer_id uuid not null references public.optical_customers(id)
);
create table public.shifts(
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null references public.branches(id),status text not null
);
create table public.recipes(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,branch_id uuid not null,product_id uuid not null
);
create table public.order_items(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,branch_id uuid not null,product_id uuid not null
);
create or replace function public.can_manage_optical_customer_data(p_tenant uuid,p_branch uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select auth.uid() is not null and exists(
    select 1 from public.user_branch_roles r
     where r.user_id=auth.uid() and r.tenant_id=p_tenant and r.branch_id=p_branch
      and r.role in ('owner','manager'))
$$;

insert into public.tenants values
 ('00000000-0000-4000-8000-000000000001','QA-OPTICAL'),
 ('00000000-0000-4000-8000-000000000002','FOOD-OTHER');
insert into public.branches values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','Optical QA'),
 ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000002','Food QA');
insert into public.users_profiles values
 ('00000000-0000-4000-8000-000000000101',true,null),
 ('00000000-0000-4000-8000-000000000102',true,null);
insert into public.user_branch_roles(user_id,tenant_id,branch_id,role) values
 ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','owner'),
 ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000022','owner');
insert into public.subscription_packages values
 ('00000000-0000-4000-8000-000000000501','custom'),
 ('00000000-0000-4000-8000-000000000502','growth');
insert into public.tenant_subscription_contracts(tenant_id,package_id,status,metadata) values
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000501','active',
  '{"sales_modes":{"optical_retail":true},"custom_features":{"optical_work_orders":true,"optical_deposit":true,"optical_inventory":true}}'),
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000502','active','{}');
insert into public.optical_customers(id,tenant_id,branch_id,full_name) values
 ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','Synthetic QA Customer');
insert into public.products(id,tenant_id,branch_id,sku,name,price) values
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','OPT-FRAME-001','Synthetic Optical Frame',1000),
 ('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000022','FOOD-001','Synthetic Food',50);
insert into public.recipes(tenant_id,branch_id,product_id) values
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000202');
insert into public.shifts values
 ('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','open');

-- Synthetic owner reports also read assigned roles directly under authenticated RLS.
grant select on public.users_profiles,public.user_branch_roles to authenticated;
