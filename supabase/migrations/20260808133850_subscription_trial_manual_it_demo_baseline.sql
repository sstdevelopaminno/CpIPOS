-- CpIPOS subscription / trial baseline (2026-08-08)
-- Source of truth:
--   STARTER 350 THB, GROWTH 550 THB, CUSTOM configurable.
--   Trial = 7 days, trial data retention = 30 days from first trial activation.
--   Paid cycle = 30 days. Activation/renewal requires explicit IT approval.
--   NDL-TH-001 is an internal Sales/IT demo tenant on CUSTOM and quota-exempt.
--   TEST-TH-003 keeps its internal tenant identity but uses public store code 100001.
--   BBQ-TH-002 is retired.

alter table public.subscription_packages
  add column if not exists max_products integer,
  add column if not exists monthly_bill_limit integer,
  add column if not exists storage_limit_gb numeric(12,2),
  add column if not exists retention_months integer,
  add column if not exists max_staff_users integer,
  add column if not exists max_owner_users integer,
  add column if not exists max_manager_users integer,
  add column if not exists csv_export_enabled boolean not null default false,
  add column if not exists tablet_pos_enabled boolean not null default false,
  add column if not exists windows_pos_enabled boolean not null default false,
  add column if not exists mobile_app_enabled boolean not null default false,
  add column if not exists quota_mode text not null default 'standard',
  add column if not exists display_order integer;

alter table public.subscription_packages drop constraint if exists subscription_packages_quota_mode_chk;
alter table public.subscription_packages
  add constraint subscription_packages_quota_mode_chk
  check (quota_mode in ('standard', 'custom', 'exempt'));

-- Public package matrix. Historical packages remain for contract history but are hidden.
update public.subscription_packages
set monthly_price = 350,
    yearly_price = 0,
    max_branches = 1,
    max_devices = 1,
    max_users = 4,
    max_products = 1000,
    monthly_bill_limit = 3000,
    storage_limit_gb = 3,
    retention_months = 6,
    max_staff_users = 2,
    max_owner_users = 1,
    max_manager_users = 1,
    csv_export_enabled = true,
    tablet_pos_enabled = true,
    windows_pos_enabled = true,
    mobile_app_enabled = false,
    quota_mode = 'standard',
    display_order = 1,
    is_active = true,
    status = 'active',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'public_package', true,
      'mutable_pricing', true,
      'billing_cycle_days', 30,
      'retention_anchor', 'first_package_started_at'
    ),
    updated_at = now()
where code = 'starter';

update public.subscription_packages
set monthly_price = 550,
    yearly_price = 0,
    max_branches = 1,
    max_devices = 2,
    max_users = 9,
    max_products = 2000,
    monthly_bill_limit = 5000,
    storage_limit_gb = 5,
    retention_months = 12,
    max_staff_users = 5,
    max_owner_users = 2,
    max_manager_users = 2,
    csv_export_enabled = true,
    tablet_pos_enabled = true,
    windows_pos_enabled = true,
    mobile_app_enabled = false,
    quota_mode = 'standard',
    display_order = 2,
    is_active = true,
    status = 'active',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'public_package', true,
      'mutable_pricing', true,
      'billing_cycle_days', 30,
      'retention_anchor', 'first_package_started_at'
    ),
    updated_at = now()
where code = 'growth';

insert into public.subscription_packages (
  code, name, monthly_price, yearly_price, max_branches, max_devices, max_users,
  max_products, monthly_bill_limit, storage_limit_gb, retention_months,
  max_staff_users, max_owner_users, max_manager_users,
  csv_export_enabled, tablet_pos_enabled, windows_pos_enabled, mobile_app_enabled,
  quota_mode, display_order, is_active, status, metadata
)
values (
  'custom', 'CUSTOM', 0, 0, 999999, 999999, 999999,
  null, null, null, null,
  null, null, null,
  true, true, true, false,
  'custom', 3, true, 'active',
  jsonb_build_object('public_package', true, 'mutable_pricing', true, 'contact_sales', true, 'billing_cycle_days', 30)
)
on conflict (code) do update
set name = excluded.name,
    monthly_price = excluded.monthly_price,
    yearly_price = excluded.yearly_price,
    max_branches = excluded.max_branches,
    max_devices = excluded.max_devices,
    max_users = excluded.max_users,
    csv_export_enabled = excluded.csv_export_enabled,
    tablet_pos_enabled = excluded.tablet_pos_enabled,
    windows_pos_enabled = excluded.windows_pos_enabled,
    quota_mode = excluded.quota_mode,
    display_order = excluded.display_order,
    is_active = true,
    status = 'active',
    metadata = coalesce(public.subscription_packages.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

update public.subscription_packages
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('public_package', false)
where code not in ('starter', 'growth', 'custom');

alter table public.tenant_data_lifecycle
  add column if not exists first_package_started_at timestamptz,
  add column if not exists current_package_started_at timestamptz,
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists retention_until timestamptz,
  add column if not exists access_locked boolean not null default false,
  add column if not exists lock_reason text,
  add column if not exists payment_review_status text not null default 'none',
  add column if not exists payment_reviewed_at timestamptz,
  add column if not exists payment_reviewed_by uuid;

alter table public.tenant_data_lifecycle drop constraint if exists tenant_data_lifecycle_payment_review_status_chk;
alter table public.tenant_data_lifecycle
  add constraint tenant_data_lifecycle_payment_review_status_chk
  check (payment_review_status in ('none','pending','under_review','approved','rejected'));

create table if not exists public.tenant_subscription_payment_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  requested_package_id uuid references public.subscription_packages(id),
  request_type text not null check (request_type in ('trial_conversion','renewal','new_subscription','package_change')),
  amount_reported numeric(12,2),
  currency text not null default 'THB',
  evidence_url text,
  status text not null default 'pending' check (status in ('pending','under_review','approved','rejected','cancelled')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_subscription_approval_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  payment_request_id uuid references public.tenant_subscription_payment_requests(id) on delete set null,
  action text not null check (action in ('approve','reject','lock','unlock','trial_start','renewal')),
  actor_id uuid,
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_demo_reset_policies (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  reset_interval_days integer not null default 30 check (reset_interval_days between 1 and 365),
  last_reset_at timestamptz,
  next_reset_at timestamptz not null,
  is_enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_demo_reset_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reset_started_at timestamptz not null default now(),
  reset_completed_at timestamptz,
  status text not null default 'started' check (status in ('started','completed','failed')),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.tenant_subscription_payment_requests enable row level security;
alter table public.tenant_subscription_approval_events enable row level security;
alter table public.tenant_demo_reset_policies enable row level security;
alter table public.tenant_demo_reset_audit enable row level security;

-- Server-side only. No customer role receives direct write access.
revoke all on public.tenant_subscription_payment_requests from anon, authenticated;
revoke all on public.tenant_subscription_approval_events from anon, authenticated;
revoke all on public.tenant_demo_reset_policies from anon, authenticated;
revoke all on public.tenant_demo_reset_audit from anon, authenticated;
grant all on public.tenant_subscription_payment_requests to service_role;
grant all on public.tenant_subscription_approval_events to service_role;
grant all on public.tenant_demo_reset_policies to service_role;
grant all on public.tenant_demo_reset_audit to service_role;

-- Manual IT approval is the only operation that may unlock a paid subscription.
create or replace function app.approve_paid_subscription(
  p_tenant_id uuid,
  p_package_code text,
  p_actor_id uuid default null,
  p_payment_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_package public.subscription_packages%rowtype;
  v_lifecycle public.tenant_data_lifecycle%rowtype;
  v_now timestamptz := now();
  v_base timestamptz;
  v_new_expiry timestamptz;
  v_retention timestamptz;
begin
  select * into v_package
  from public.subscription_packages
  where code = lower(trim(p_package_code)) and is_active = true;
  if not found then raise exception 'package_not_found'; end if;

  select * into v_lifecycle
  from public.tenant_data_lifecycle
  where tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'tenant_lifecycle_not_found'; end if;

  -- Trial conversion cannot unlock until the data has been verified back on Primary.
  if v_lifecycle.lifecycle_status = 'trial'
     and (v_lifecycle.data_home <> 'primary' or v_lifecycle.migration_status not in ('idle','completed','verified')) then
    raise exception 'trial_primary_migration_not_verified';
  end if;

  v_base := greatest(v_now, coalesce(v_lifecycle.subscription_expires_at, v_now));
  v_new_expiry := v_base + interval '30 days';
  if v_lifecycle.first_package_started_at is null then
    v_lifecycle.first_package_started_at := v_now;
  end if;
  v_retention := case
    when v_package.retention_months is null then null
    else v_lifecycle.first_package_started_at + make_interval(months => v_package.retention_months)
  end;

  update public.tenants set package_id = v_package.id where id = p_tenant_id;
  update public.tenant_data_lifecycle
  set lifecycle_status = 'active',
      desired_data_home = 'primary',
      first_package_started_at = v_lifecycle.first_package_started_at,
      current_package_started_at = v_now,
      subscription_expires_at = v_new_expiry,
      retention_until = v_retention,
      access_locked = false,
      lock_reason = null,
      payment_review_status = 'approved',
      payment_reviewed_at = v_now,
      payment_reviewed_by = p_actor_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('last_it_approval_at', v_now, 'package_code', v_package.code)
  where tenant_id = p_tenant_id;

  update public.tenant_subscription_contracts
  set status = 'cancelled', ended_at = v_now, updated_at = v_now
  where tenant_id = p_tenant_id and status in ('active','trial');

  insert into public.tenant_subscription_contracts (
    tenant_id, package_id, contract_type, billing_interval, deployment_mode,
    status, branch_limit, terminal_limit_per_branch, amount_per_cycle,
    currency, auto_renew, started_at, ended_at, metadata
  ) values (
    p_tenant_id, v_package.id, 'saas', 'monthly', 'hybrid',
    'active', v_package.max_branches, greatest(1, coalesce(v_package.max_devices,1)), v_package.monthly_price,
    'THB', false, v_now, v_new_expiry,
    jsonb_build_object('manual_it_approval', true, 'payment_request_id', p_payment_request_id)
  );

  if p_payment_request_id is not null then
    update public.tenant_subscription_payment_requests
    set status='approved', reviewed_at=v_now, reviewed_by=p_actor_id, updated_at=v_now
    where id=p_payment_request_id and tenant_id=p_tenant_id;
  end if;

  insert into public.tenant_subscription_approval_events
    (tenant_id,payment_request_id,action,actor_id,from_status,to_status,metadata)
  values
    (p_tenant_id,p_payment_request_id,'approve',p_actor_id,v_lifecycle.lifecycle_status,'active',jsonb_build_object('package_code',v_package.code,'expires_at',v_new_expiry));
end;
$$;

revoke all on function app.approve_paid_subscription(uuid,text,uuid,uuid) from public, anon, authenticated;
grant execute on function app.approve_paid_subscription(uuid,text,uuid,uuid) to service_role;

-- Locking may happen automatically on expiry; unlocking never does.
create or replace function app.refresh_subscription_locks()
returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare v_count integer := 0;
begin
  update public.tenant_data_lifecycle
  set access_locked = true,
      lock_reason = case when lifecycle_status='trial' then 'trial_expired' else 'subscription_expired' end,
      lifecycle_status = case when lifecycle_status='trial' then 'expired' else lifecycle_status end
  where access_locked = false
    and (
      (lifecycle_status='trial' and trial_expires_at is not null and trial_expires_at <= now())
      or
      (lifecycle_status='active' and subscription_expires_at is not null and subscription_expires_at <= now())
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function app.refresh_subscription_locks() from public, anon, authenticated;
grant execute on function app.refresh_subscription_locks() to service_role;

-- NDL-TH-001: internal Sales/IT demo, CUSTOM, exempt from customer quotas.
do $$
declare
  v_tenant uuid;
  v_custom uuid;
  v_now timestamptz := now();
begin
  select id into v_tenant from public.tenants where code='NDL-TH-001';
  select id into v_custom from public.subscription_packages where code='custom';
  if v_tenant is not null and v_custom is not null then
    update public.tenants set package_id=v_custom where id=v_tenant;
    update public.tenant_data_lifecycle
    set lifecycle_status='sales_demo', data_home='primary', desired_data_home='primary', migration_status='idle',
        access_locked=false, lock_reason=null, payment_review_status='none',
        metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('internal_demo',true,'quota_exempt',true,'demo_reset_days',30)
    where tenant_id=v_tenant;

    update public.tenant_subscription_contracts
    set status='cancelled', ended_at=v_now, updated_at=v_now
    where tenant_id=v_tenant and status in ('active','trial');

    insert into public.tenant_subscription_contracts (
      tenant_id,package_id,contract_type,billing_interval,deployment_mode,status,
      branch_limit,terminal_limit_per_branch,amount_per_cycle,currency,auto_renew,started_at,metadata
    ) values (
      v_tenant,v_custom,'saas','monthly','hybrid','active',999999,999999,0,'THB',false,v_now,
      jsonb_build_object('internal_demo',true,'quota_exempt',true,'demo_reset_days',30)
    );

    insert into public.tenant_demo_reset_policies (tenant_id,reset_interval_days,next_reset_at,is_enabled,metadata)
    values (v_tenant,30,v_now + interval '30 days',true,jsonb_build_object('purpose','IT/Sales demo'))
    on conflict (tenant_id) do update
      set reset_interval_days=30,
          next_reset_at=case when public.tenant_demo_reset_policies.next_reset_at < v_now then v_now + interval '30 days' else public.tenant_demo_reset_policies.next_reset_at end,
          is_enabled=true,
          metadata=excluded.metadata,
          updated_at=v_now;
  end if;
end $$;

-- TEST-TH-003 becomes the first customer-facing seed. Keep UUID/internal code stable.
do $$
declare v_tenant uuid;
begin
  select id into v_tenant from public.tenants where code='TEST-TH-003';
  if v_tenant is not null then
    delete from public.tenant_access_codes where tenant_id=v_tenant;
    insert into public.tenant_access_codes (tenant_id,access_code,purpose,is_active)
    values (v_tenant,'100001','customer',true);

    update public.tenant_data_lifecycle
    set lifecycle_status='trial',
        data_home='primary', desired_data_home='trial',
        trial_started_at=null, trial_expires_at=null, grace_until=null,
        archive_after=null, access_locked=true, lock_reason='awaiting_manual_trial_activation',
        payment_review_status='none',
        metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object('customer_seed',true,'public_store_code','100001','trial_days',7,'trial_retention_days',30)
    where tenant_id=v_tenant;
  end if;
end $$;

-- BBQ-TH-002 is explicitly retired. Tenant FK graph is CASCADE except logs that SET NULL.
delete from public.tenants where code='BBQ-TH-002';
