-- IT Store Provisioning P0
-- Business control-plane schema for the dedicated CpIPOS-IT application.
-- Atomic DB core: tenant + Store Code/lifecycle trigger + initial branch + login policy + package contract.
-- Owner Auth/profile is completed by trusted server code after this transaction because Supabase Auth is external to PostgreSQL transactions.
-- No plaintext Owner PIN is accepted or persisted by this migration.

create table if not exists public.it_store_provisioning_requests (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  actor_user_id uuid null,
  input_payload jsonb not null default '{}'::jsonb,
  tenant_id uuid null references public.tenants(id) on delete set null,
  branch_id uuid null references public.branches(id) on delete set null,
  package_id uuid null references public.subscription_packages(id) on delete set null,
  owner_user_id uuid null references public.users_profiles(id) on delete set null,
  owner_email text null,
  status text not null default 'started'
    check (status in ('started','core_provisioned','completed','owner_failed')),
  result jsonb not null default '{}'::jsonb,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists it_store_provisioning_requests_tenant_idx
  on public.it_store_provisioning_requests (tenant_id, created_at desc);

alter table public.it_store_provisioning_requests enable row level security;
revoke all on table public.it_store_provisioning_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.it_store_provisioning_requests to service_role;

grant usage on schema app to service_role;

create or replace function app.provision_it_store_core_impl(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_internal_code text,
  p_store_name text,
  p_owner_name text,
  p_owner_phone text,
  p_owner_email text,
  p_branch_code text,
  p_branch_name text,
  p_branch_address text,
  p_package_id uuid,
  p_contract_status text default 'trial',
  p_billing_interval text default 'monthly'
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public, extensions
as $$
declare
  v_request_pk uuid;
  v_existing public.it_store_provisioning_requests%rowtype;
  v_package public.subscription_packages%rowtype;
  v_tenant public.tenants%rowtype;
  v_branch public.branches%rowtype;
  v_contract public.tenant_subscription_contracts%rowtype;
  v_store_code text;
  v_lifecycle public.tenant_data_lifecycle%rowtype;
  v_price numeric;
  v_internal_code text;
  v_payload jsonb;
  v_result jsonb;
begin
  if p_request_id is null then
    raise exception 'invalid_provisioning_request: request_id is required';
  end if;
  if nullif(btrim(coalesce(p_internal_code, '')), '') is null
     or nullif(btrim(coalesce(p_store_name, '')), '') is null
     or nullif(btrim(coalesce(p_branch_code, '')), '') is null
     or nullif(btrim(coalesce(p_branch_name, '')), '') is null
     or p_package_id is null then
    raise exception 'invalid_provisioning_payload: store, branch, internal code and package are required';
  end if;
  if p_contract_status not in ('trial','active') then
    raise exception 'invalid_contract_status: new stores must start as trial or active';
  end if;
  if p_billing_interval not in ('monthly','yearly') then
    raise exception 'invalid_billing_interval: billing interval must be monthly or yearly';
  end if;

  select * into v_package
  from public.subscription_packages
  where id = p_package_id
    and is_active = true
    and status = 'active';

  if not found then
    raise exception 'package_not_available: selected package is not active';
  end if;
  if coalesce(v_package.quota_mode, 'standard') <> 'standard' then
    raise exception 'package_requires_manual_contract: custom/exempt packages require reviewed limits and pricing';
  end if;
  if coalesce(v_package.max_branches, 0) < 1
     or coalesce(v_package.max_devices, 0) < 1
     or coalesce(v_package.max_users, 0) < 1 then
    raise exception 'package_invalid_quota: package quota must allow at least one branch, device and user';
  end if;

  v_price := case when p_billing_interval = 'yearly' then v_package.yearly_price else v_package.monthly_price end;
  if v_price is null or v_price <= 0 then
    raise exception 'package_billing_interval_unavailable: selected package has no price for this billing interval';
  end if;

  -- A retry may arrive with a newly generated compatibility tenant code.
  -- The request ledger owns the first code, so request_id remains the true idempotency key.
  select * into v_existing
  from public.it_store_provisioning_requests
  where request_key = p_request_id;

  if found then
    v_internal_code := coalesce(nullif(v_existing.input_payload ->> 'internal_code', ''), upper(btrim(p_internal_code)));
  else
    v_internal_code := upper(btrim(p_internal_code));
  end if;

  v_payload := jsonb_build_object(
    'internal_code', v_internal_code,
    'store_name', btrim(p_store_name),
    'owner_name', nullif(btrim(coalesce(p_owner_name, '')), ''),
    'owner_phone', nullif(btrim(coalesce(p_owner_phone, '')), ''),
    'owner_email', lower(nullif(btrim(coalesce(p_owner_email, '')), '')),
    'branch_code', lower(btrim(p_branch_code)),
    'branch_name', btrim(p_branch_name),
    'branch_address', nullif(btrim(coalesce(p_branch_address, '')), ''),
    'package_id', p_package_id,
    'contract_status', p_contract_status,
    'billing_interval', p_billing_interval
  );

  if v_existing.id is not null then
    if v_existing.input_payload <> v_payload then
      raise exception 'provisioning_request_payload_mismatch: request_id was already used with different data';
    end if;
    if v_existing.tenant_id is not null and v_existing.result <> '{}'::jsonb then
      return v_existing.result;
    end if;
    raise exception 'provisioning_request_incomplete: retry the existing provisioning request';
  end if;

  insert into public.it_store_provisioning_requests (
    request_key, actor_user_id, input_payload, package_id, owner_email, status
  ) values (
    p_request_id, p_actor_user_id, v_payload, p_package_id,
    lower(nullif(btrim(coalesce(p_owner_email, '')), '')), 'started'
  )
  on conflict (request_key) do nothing
  returning id into v_request_pk;

  -- Concurrency-safe retry: if another request inserted the ledger first,
  -- resolve its first internal code before comparing the business payload.
  if v_request_pk is null then
    select * into v_existing
    from public.it_store_provisioning_requests
    where request_key = p_request_id;

    if not found then
      raise exception 'provisioning_request_conflict: request could not be resolved';
    end if;

    v_internal_code := coalesce(nullif(v_existing.input_payload ->> 'internal_code', ''), v_internal_code);
    v_payload := jsonb_set(v_payload, '{internal_code}', to_jsonb(v_internal_code), false);

    if v_existing.input_payload <> v_payload then
      raise exception 'provisioning_request_payload_mismatch: request_id was already used with different data';
    end if;
    if v_existing.tenant_id is not null and v_existing.result <> '{}'::jsonb then
      return v_existing.result;
    end if;
    raise exception 'provisioning_request_incomplete: retry the existing provisioning request';
  end if;

  insert into public.tenants (
    code, name, display_name, owner_name, owner_phone, package_id, is_active, company_address, contact_phone
  ) values (
    v_internal_code,
    btrim(p_store_name),
    btrim(p_store_name),
    nullif(btrim(coalesce(p_owner_name, '')), ''),
    nullif(btrim(coalesce(p_owner_phone, '')), ''),
    p_package_id,
    true,
    nullif(btrim(coalesce(p_branch_address, '')), ''),
    nullif(btrim(coalesce(p_owner_phone, '')), '')
  )
  returning * into v_tenant;

  insert into public.branches (tenant_id, code, name, address, is_active)
  values (
    v_tenant.id,
    lower(btrim(p_branch_code)),
    btrim(p_branch_name),
    nullif(btrim(coalesce(p_branch_address, '')), ''),
    true
  )
  returning * into v_branch;

  insert into public.branch_login_policies (
    tenant_id,
    branch_id,
    require_qr_login,
    allow_pin_login,
    allow_staff_card_login,
    allow_shared_devices,
    require_registered_device,
    max_devices,
    allow_mobile_qr_login,
    require_mobile_device_enrollment,
    allow_mobile_slip_scan
  ) values (
    v_tenant.id,
    v_branch.id,
    false,
    true,
    true,
    false,
    true,
    greatest(1, v_package.max_devices),
    false,
    true,
    false
  );

  insert into public.tenant_subscription_contracts (
    tenant_id,
    package_id,
    contract_type,
    billing_interval,
    deployment_mode,
    status,
    branch_limit,
    terminal_limit_per_branch,
    max_branches,
    max_devices,
    max_users,
    amount_per_cycle,
    currency,
    started_at,
    ended_at,
    metadata
  ) values (
    v_tenant.id,
    v_package.id,
    'saas',
    p_billing_interval,
    'cloud',
    p_contract_status,
    v_package.max_branches,
    v_package.max_devices,
    v_package.max_branches,
    v_package.max_devices,
    v_package.max_users,
    v_price,
    'THB',
    now(),
    null,
    jsonb_build_object('source', 'cpipos_it_store_provisioning_p0', 'package_code', v_package.code)
  )
  returning * into v_contract;

  -- The existing tenant insert trigger is the single Store Code/lifecycle allocator.
  select access_code into v_store_code
  from public.tenant_access_codes
  where tenant_id = v_tenant.id and is_active = true
  order by issued_at desc
  limit 1;

  select * into v_lifecycle
  from public.tenant_data_lifecycle
  where tenant_id = v_tenant.id;

  if v_store_code is null or v_lifecycle.tenant_id is null then
    raise exception 'tenant_control_plane_provision_failed: Store Code or lifecycle was not created';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'code', v_tenant.code,
      'name', v_tenant.name,
      'is_active', v_tenant.is_active
    ),
    'store_code', v_store_code,
    'branch', jsonb_build_object(
      'id', v_branch.id,
      'code', v_branch.code,
      'name', v_branch.name,
      'address', v_branch.address
    ),
    'package', jsonb_build_object(
      'id', v_package.id,
      'code', v_package.code,
      'name', v_package.name,
      'max_branches', v_package.max_branches,
      'max_devices', v_package.max_devices,
      'max_users', v_package.max_users,
      'amount_per_cycle', v_price,
      'billing_interval', p_billing_interval,
      'currency', 'THB'
    ),
    'contract', jsonb_build_object(
      'id', v_contract.id,
      'status', v_contract.status,
      'billing_interval', v_contract.billing_interval,
      'amount_per_cycle', v_contract.amount_per_cycle,
      'currency', v_contract.currency
    ),
    'lifecycle', jsonb_build_object(
      'status', v_lifecycle.lifecycle_status,
      'data_home', v_lifecycle.data_home,
      'desired_data_home', v_lifecycle.desired_data_home,
      'migration_status', v_lifecycle.migration_status,
      'trial_started_at', v_lifecycle.trial_started_at,
      'trial_expires_at', v_lifecycle.trial_expires_at,
      'routing_version', v_lifecycle.routing_version
    )
  );

  update public.it_store_provisioning_requests
  set tenant_id = v_tenant.id,
      branch_id = v_branch.id,
      status = 'core_provisioned',
      result = v_result,
      last_error = null,
      updated_at = now()
  where id = v_request_pk;

  return v_result;
end;
$$;

revoke all on function app.provision_it_store_core_impl(uuid,uuid,text,text,text,text,text,text,text,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function app.provision_it_store_core_impl(uuid,uuid,text,text,text,text,text,text,text,text,uuid,text,text)
  to service_role;

create or replace function public.provision_it_store_core(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_internal_code text,
  p_store_name text,
  p_owner_name text,
  p_owner_phone text,
  p_owner_email text,
  p_branch_code text,
  p_branch_name text,
  p_branch_address text,
  p_package_id uuid,
  p_contract_status text default 'trial',
  p_billing_interval text default 'monthly'
)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, app, extensions
as $$
  select app.provision_it_store_core_impl(
    p_request_id,
    p_actor_user_id,
    p_internal_code,
    p_store_name,
    p_owner_name,
    p_owner_phone,
    p_owner_email,
    p_branch_code,
    p_branch_name,
    p_branch_address,
    p_package_id,
    p_contract_status,
    p_billing_interval
  );
$$;

revoke all on function public.provision_it_store_core(uuid,uuid,text,text,text,text,text,text,text,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.provision_it_store_core(uuid,uuid,text,text,text,text,text,text,text,text,uuid,text,text)
  to service_role;

comment on table public.it_store_provisioning_requests is
  'Idempotency/recovery ledger for CpIPOS-IT Store Provisioning. Never stores plaintext Owner PIN.';
comment on function public.provision_it_store_core(uuid,uuid,text,text,text,text,text,text,text,text,uuid,text,text) is
  'Service-role-only invoker-rights Store Provisioning RPC. Business data remains authoritative in CpiPOS-001.';
