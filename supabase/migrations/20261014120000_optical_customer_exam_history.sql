-- Additive optical-customer history for IT-authorized CUSTOM Optical stores.
-- No existing POS orders, stock, payment or subscription rows are modified.
-- Review against a staging snapshot before applying to production.
create unique index if not exists branches_id_tenant_scope_idx on public.branches(id,tenant_id);

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
  request_id uuid not null,
  created_at timestamptz not null default now(),
  constraint optical_exam_idempotency unique (tenant_id,branch_id,request_id),
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
      select 1 from public.users_profiles profile
      where profile.id = auth.uid() and profile.is_active = true and profile.archived_at is null
    )
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
        and c.id = (
          select latest.id from public.tenant_subscription_contracts latest
          where latest.tenant_id = p_tenant order by latest.created_at desc limit 1
        )
        and c.status in ('active','trial')
        and (c.ended_at is null or c.ended_at > now())
        and lower(pkg.code)='custom'
        and c.metadata->'sales_modes'->>'optical_retail'='true'
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

-- Single-transaction Optical customer registration + examination history.
-- Permission checks also apply when called directly by Customer Portal.
create or replace function public.optical_save_customer_exam(
  p_tenant_id uuid, p_branch_id uuid, p_customer_code text,
  p_full_name text, p_phone text default null,
  p_age smallint default null, p_exam_date date default null,
  p_previous_prescription text default null, p_pd_mm numeric default null,
  p_examiner_name text default null,
  p_right_sph numeric default null, p_right_cyl numeric default null,
  p_right_axis smallint default null, p_right_add numeric default null,
  p_left_sph numeric default null, p_left_cyl numeric default null,
  p_left_axis smallint default null, p_left_add numeric default null,
  p_notes text default null, p_request_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_customer_id uuid; v_exam_id uuid; v_request_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.can_manage_optical_customer_data(p_tenant_id,p_branch_id) then
    raise exception 'optical_customer_forbidden' using errcode='42501';
  end if;
  if p_tenant_id is null or p_branch_id is null
     or length(trim(coalesce(p_customer_code,''))) not between 1 and 48
     or length(trim(coalesce(p_full_name,''))) not between 1 and 240 then
    raise exception 'invalid_optical_customer' using errcode='22023';
  end if;
  if p_age is not null and p_age not between 0 and 130 then
    raise exception 'invalid_customer_age' using errcode='22023';
  end if;
  if p_pd_mm is not null and p_pd_mm not between 30 and 90 then
    raise exception 'invalid_pd_mm' using errcode='22023';
  end if;
  if p_exam_date is null then
    raise exception 'exam_date_required' using errcode='22023';
  end if;
  v_request_id := coalesce(p_request_id, gen_random_uuid());
  insert into public.optical_customers
    (tenant_id,branch_id,customer_code,full_name,phone,age,
     previous_prescription,last_exam_date,examiner_name,notes,created_by,updated_by)
  values
    (p_tenant_id,p_branch_id,trim(p_customer_code),trim(p_full_name),
     nullif(trim(coalesce(p_phone,'')),''),p_age,p_previous_prescription,
     p_exam_date,p_examiner_name,p_notes,auth.uid(),auth.uid())
  on conflict (tenant_id,branch_id,customer_code) do update set
    full_name=excluded.full_name,phone=excluded.phone,age=excluded.age,
    previous_prescription=excluded.previous_prescription,
    last_exam_date=excluded.last_exam_date,examiner_name=excluded.examiner_name,
    notes=excluded.notes,updated_at=now(),updated_by=auth.uid(),deleted_at=null
  returning id into v_customer_id;

  insert into public.optical_eye_exams
    (tenant_id,branch_id,customer_id,examined_at,age_at_exam,right_sph,right_cyl,right_axis,
     right_add,left_sph,left_cyl,left_axis,left_add,pd_mm,previous_prescription,examiner_name,notes,created_by,request_id)
  values
    (p_tenant_id,p_branch_id,v_customer_id,p_exam_date,p_age,p_right_sph,p_right_cyl,p_right_axis,
     p_right_add,p_left_sph,p_left_cyl,p_left_axis,p_left_add,p_pd_mm,p_previous_prescription,p_examiner_name,p_notes,auth.uid(),v_request_id)
  on conflict (tenant_id,branch_id,request_id) do nothing
  returning id into v_exam_id;

  if v_exam_id is null then
    select id into v_exam_id from public.optical_eye_exams
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and request_id=v_request_id and customer_id=v_customer_id;
    if v_exam_id is null then
      raise exception 'optical_exam_idempotency_conflict' using errcode='23505';
    end if;
  end if;

  return jsonb_build_object('customer_id',v_customer_id,'exam_id',v_exam_id,'request_id',v_request_id);
end;
$$;
revoke all on function public.optical_save_customer_exam(
  uuid,uuid,text,text,text,smallint,date,text,numeric,text,numeric,numeric,smallint,numeric,
  numeric,numeric,smallint,numeric,text,uuid
) from public,anon;
grant execute on function public.optical_save_customer_exam(
  uuid,uuid,text,text,text,smallint,date,text,numeric,text,numeric,numeric,smallint,numeric,
  numeric,numeric,smallint,numeric,text,uuid
) to authenticated,service_role;
