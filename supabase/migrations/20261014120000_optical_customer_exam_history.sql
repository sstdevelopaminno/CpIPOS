-- Additive optical-customer history for IT-authorized CUSTOM Optical stores.
-- No existing POS orders, stock, payment or subscription rows are modified.
-- Review against a staging snapshot before applying to production.
create table if not exists public.optical_customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  customer_code text not null,
  full_name text not null,
  phone text,
  age smallint check (age between 0 and 130),
  previous_prescription text,
  last_exam_date date,
  examiner_name text,
  notes text,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint optical_customer_code_format check (
    length(trim(customer_code)) between 1 and 48 and length(full_name) between 1 and 240
  ),
  constraint optical_customers_scope_unique unique (tenant_id,branch_id,id),
  constraint optical_customers_code_unique unique (tenant_id,branch_id,customer_code),
  constraint optical_customers_branch_scope foreign key (branch_id,tenant_id)
    references public.branches(id,tenant_id)
);
create index if not exists optical_customers_lookup_idx
  on public.optical_customers(tenant_id,branch_id,deleted_at,customer_code);

create table if not exists public.optical_eye_exams (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  customer_id uuid not null,
  examined_at date not null,
  age_at_exam smallint check (age_at_exam between 0 and 130),
  right_sph numeric(6,2),
  right_cyl numeric(6,2),
  right_axis smallint check (right_axis between 0 and 180),
  right_add numeric(6,2),
  left_sph numeric(6,2),
  left_cyl numeric(6,2),
  left_axis smallint check (left_axis between 0 and 180),
  left_add numeric(6,2),
  pd_mm numeric(5,1) check (pd_mm between 30 and 90),
  previous_prescription text,
  examiner_name text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint optical_exam_customer_scope foreign key (tenant_id,branch_id,customer_id)
    references public.optical_customers(tenant_id,branch_id,id)
);
create index if not exists optical_eye_exams_history_idx
  on public.optical_eye_exams(tenant_id,branch_id,customer_id,examined_at desc);

-- Restrict direct CRM access at the DB boundary. POS server-side service
-- role still independently checks POS session + IT Optical entitlement.
create or replace function public.can_manage_optical_customer_data(
  p_tenant uuid, p_branch uuid
) returns boolean language sql stable security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1 from public.user_branch_roles ubr
      where ubr.user_id=auth.uid() and ubr.tenant_id=p_tenant
        and ubr.branch_id=p_branch and ubr.role::text in ('owner','manager')
    )
    and exists (
      select 1
      from public.tenant_subscription_contracts c
      join public.subscription_packages pkg on pkg.id=c.package_id
      where c.tenant_id=p_tenant
        and c.status in ('active','trial')
        and (c.ended_at is null or c.ended_at > now())
        and lower(pkg.code)='custom'
        and c.metadata->'sales_modes'->>'optical_retail'='true'
      order by c.created_at desc
      limit 1
    );
$$;
revoke all on function public.can_manage_optical_customer_data(uuid,uuid) from public, anon;
grant execute on function public.can_manage_optical_customer_data(uuid,uuid) to authenticated, service_role;

alter table public.optical_customers enable row level security;
alter table public.optical_eye_exams enable row level security;
revoke all on public.optical_customers,public.optical_eye_exams from anon;
grant select,insert,update on public.optical_customers to authenticated;
grant select,insert on public.optical_eye_exams to authenticated;

create policy optical_customers_select on public.optical_customers for select to authenticated
 using (public.can_manage_optical_customer_data(tenant_id,branch_id));
create policy optical_customers_insert on public.optical_customers for insert to authenticated
 with check (public.can_manage_optical_customer_data(tenant_id,branch_id));
create policy optical_customers_update on public.optical_customers for update to authenticated
 using (public.can_manage_optical_customer_data(tenant_id,branch_id))
 with check (public.can_manage_optical_customer_data(tenant_id,branch_id));
create policy optical_exams_select on public.optical_eye_exams for select to authenticated
 using (public.can_manage_optical_customer_data(tenant_id,branch_id));
create policy optical_exams_insert on public.optical_eye_exams for insert to authenticated
 with check (public.can_manage_optical_customer_data(tenant_id,branch_id));

comment on table public.optical_customers is 'Tenant/branch-isolated Optical customer registry, private health-related optometry information.';
comment on table public.optical_eye_exams is 'Immutable Optical refraction history; corrections require new dated examination.';
