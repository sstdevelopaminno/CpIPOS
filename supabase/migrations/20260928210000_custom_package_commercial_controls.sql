-- CpIPOS package commercial controls + per-tenant CUSTOM terms (2026-09-28)
-- Standard package sales history retention is fixed at 6 months.
-- CUSTOM keeps per-tenant commercial/quota/retention terms under IT authority.

alter table public.subscription_packages
  add column if not exists monthly_discount_percent numeric(5,2) not null default 0,
  add column if not exists yearly_discount_percent numeric(5,2) not null default 0;

alter table public.subscription_packages drop constraint if exists subscription_packages_monthly_discount_chk;
alter table public.subscription_packages
  add constraint subscription_packages_monthly_discount_chk
  check (monthly_discount_percent between 0 and 100);
alter table public.subscription_packages drop constraint if exists subscription_packages_yearly_discount_chk;
alter table public.subscription_packages
  add constraint subscription_packages_yearly_discount_chk
  check (yearly_discount_percent between 0 and 100);

alter table public.store_registration_requests
  add column if not exists custom_requirements text,
  add column if not exists custom_terms jsonb not null default '{}'::jsonb;

create table if not exists public.tenant_custom_package_terms (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  package_id uuid not null references public.subscription_packages(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft','approved','active','retired')),
  monthly_price numeric(12,2) not null default 0 check (monthly_price >= 0),
  yearly_price numeric(12,2) not null default 0 check (yearly_price >= 0),
  monthly_discount_percent numeric(5,2) not null default 0
    check (monthly_discount_percent between 0 and 100),
  yearly_discount_percent numeric(5,2) not null default 0
    check (yearly_discount_percent between 0 and 100),
  max_branches integer not null default 1 check (max_branches between 1 and 10000),
  max_devices integer not null default 1 check (max_devices between 1 and 10000),
  max_users integer not null default 1 check (max_users between 1 and 100000),
  retention_months integer not null default 6 check (retention_months between 1 and 120),
  max_products integer check (max_products is null or max_products between 1 and 10000000),
  monthly_bill_limit integer check (monthly_bill_limit is null or monthly_bill_limit between 1 and 100000000),
  storage_limit_gb numeric(12,2) check (storage_limit_gb is null or storage_limit_gb > 0),
  feature_overrides jsonb not null default '{}'::jsonb,
  notes text,
  version bigint not null default 1 check (version >= 1),
  approved_by uuid references public.users_profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_custom_package_terms_status_idx
  on public.tenant_custom_package_terms(status, updated_at desc);

alter table public.tenant_custom_package_terms enable row level security;
revoke all on public.tenant_custom_package_terms from public, anon, authenticated;
grant select, insert, update, delete on public.tenant_custom_package_terms to service_role;

comment on table public.tenant_custom_package_terms is
  'IT-managed commercial and quota terms for one tenant using the canonical CUSTOM package. Browser/POS roles have no direct access.';

create or replace function app.enforce_package_commercial_rules()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
begin
  new.monthly_discount_percent := greatest(0, least(100, coalesce(new.monthly_discount_percent,0)));
  new.yearly_discount_percent := greatest(0, least(100, coalesce(new.yearly_discount_percent,0)));

  -- Standard plans have one global transaction-history policy.
  if coalesce(new.quota_mode,'standard') = 'standard' then
    new.retention_months := 6;
  end if;

  -- Canonical CUSTOM has no global commercial quota. Per-tenant terms own it.
  if lower(coalesce(new.code,'')) = 'custom' then
    new.quota_mode := 'custom';
    new.monthly_price := 0;
    new.yearly_price := 0;
    new.retention_months := null;
    new.metadata := coalesce(new.metadata,'{}'::jsonb)
      || jsonb_build_object(
        'contact_sales', true,
        'it_admin_managed', true,
        'custom_contract_required', true,
        'device_quota_source', 'tenant_contract'
      );
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_subscription_packages_commercial_rules on public.subscription_packages;
create trigger trg_subscription_packages_commercial_rules
before insert or update on public.subscription_packages
for each row execute function app.enforce_package_commercial_rules();

-- Apply the new standard retention policy immediately.
update public.subscription_packages
set retention_months = 6,
    updated_at = now()
where quota_mode = 'standard';

update public.subscription_packages
set retention_months = null,
    monthly_price = 0,
    yearly_price = 0,
    metadata = coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'contact_sales',true,
        'it_admin_managed',true,
        'custom_contract_required',true,
        'device_quota_source','tenant_contract'
      ),
    updated_at = now()
where code = 'custom';

create or replace function app.touch_custom_package_terms()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $$
declare
  v_quota_mode text;
begin
  select quota_mode into v_quota_mode
  from public.subscription_packages
  where id = new.package_id;

  if coalesce(v_quota_mode,'') <> 'custom' then
    raise exception 'custom_terms_require_custom_package';
  end if;

  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_custom_package_terms on public.tenant_custom_package_terms;
create trigger trg_touch_custom_package_terms
before insert or update on public.tenant_custom_package_terms
for each row execute function app.touch_custom_package_terms();

create or replace function app.sales_retention_months_for_tenant(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select case
    when coalesce(sp.quota_mode,'standard') = 'custom' then
      greatest(
        1,
        least(
          120,
          coalesce(
            cpt.retention_months,
            case
              when coalesce(tdl.metadata->>'sales_retention_months','') ~ '^[1-9][0-9]{0,2}$'
                then (tdl.metadata->>'sales_retention_months')::integer
              else null
            end,
            6
          )
        )
      )
    else 6
  end
  from public.tenants t
  left join public.subscription_packages sp on sp.id = t.package_id
  left join public.tenant_data_lifecycle tdl on tdl.tenant_id = t.id
  left join public.tenant_custom_package_terms cpt
    on cpt.tenant_id = t.id
   and cpt.package_id = sp.id
   and cpt.status in ('approved','active')
  where t.id = p_tenant_id;
$$;

revoke all on function app.sales_retention_months_for_tenant(uuid) from public, anon, authenticated;
grant execute on function app.sales_retention_months_for_tenant(uuid) to service_role;

-- Settlement already carries a trusted payment-request id into contract metadata.
-- When the requested package is CUSTOM, copy only the reviewed snapshot limits;
-- never allow the canonical 999999 compatibility ceilings to reach a live contract.
create or replace function app.apply_custom_contract_limits()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_quota_mode text;
  v_request_id uuid;
  v_snapshot jsonb;
  v_terms public.tenant_custom_package_terms%rowtype;
begin
  select quota_mode into v_quota_mode
  from public.subscription_packages
  where id = new.package_id;

  if coalesce(v_quota_mode,'standard') <> 'custom' then
    return new;
  end if;

  begin
    v_request_id := nullif(
      coalesce(new.metadata->>'payment_request_id', new.metadata->>'last_payment_request_id'),
      ''
    )::uuid;
  exception when others then
    v_request_id := null;
  end;

  if v_request_id is not null then
    select metadata->'custom_terms_snapshot' into v_snapshot
    from public.tenant_subscription_payment_requests
    where id = v_request_id
      and tenant_id = new.tenant_id;
  end if;

  if v_snapshot is not null and jsonb_typeof(v_snapshot) = 'object' then
    if coalesce(v_snapshot->>'max_branches','') !~ '^[1-9][0-9]*$'
       or coalesce(v_snapshot->>'max_devices','') !~ '^[1-9][0-9]*$'
       or coalesce(v_snapshot->>'max_users','') !~ '^[1-9][0-9]*$' then
      raise exception 'custom_terms_snapshot_invalid';
    end if;

    new.max_branches := (v_snapshot->>'max_branches')::integer;
    new.branch_limit := new.max_branches;
    new.max_devices := (v_snapshot->>'max_devices')::integer;
    new.terminal_limit_per_branch := new.max_devices;
    new.max_users := (v_snapshot->>'max_users')::integer;
    new.metadata := coalesce(new.metadata,'{}'::jsonb)
      || jsonb_build_object('custom_terms_snapshot',v_snapshot);
    return new;
  end if;

  -- Trial registrations do not yet have a payment request. They may use an
  -- IT-reviewed tenant terms row; otherwise remain at the minimum safe quota.
  select * into v_terms
  from public.tenant_custom_package_terms
  where tenant_id = new.tenant_id
    and package_id = new.package_id
    and status in ('approved','active');

  if found then
    new.max_branches := v_terms.max_branches;
    new.branch_limit := v_terms.max_branches;
    new.max_devices := v_terms.max_devices;
    new.terminal_limit_per_branch := v_terms.max_devices;
    new.max_users := v_terms.max_users;
  else
    new.max_branches := 1;
    new.branch_limit := 1;
    new.max_devices := 1;
    new.terminal_limit_per_branch := 1;
    new.max_users := 1;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_custom_contract_limits on public.tenant_subscription_contracts;
create trigger trg_apply_custom_contract_limits
before insert or update of package_id,max_branches,max_devices,max_users,metadata
on public.tenant_subscription_contracts
for each row execute function app.apply_custom_contract_limits();

-- Safe deletion endpoint for the IT package catalog. Canonical or referenced
-- plans are retired, while truly unused non-canonical plans can be removed.
create or replace function public.it_delete_subscription_package_safe(
  p_package_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_pkg public.subscription_packages%rowtype;
  v_referenced boolean;
begin
  select * into v_pkg
  from public.subscription_packages
  where id = p_package_id
  for update;

  if not found then return null; end if;

  v_referenced :=
    exists(select 1 from public.tenants where package_id=p_package_id)
    or exists(select 1 from public.tenant_subscription_contracts where package_id=p_package_id)
    or exists(select 1 from public.tenant_subscription_payment_requests where requested_package_id=p_package_id)
    or exists(select 1 from public.tenant_billing_cycles where package_id=p_package_id)
    or exists(select 1 from public.tenant_subscription_settlements where package_id=p_package_id)
    or exists(select 1 from public.store_registration_requests where package_id=p_package_id)
    or exists(select 1 from public.it_store_provisioning_requests where package_id=p_package_id);

  if lower(v_pkg.code) in ('starter','growth','custom')
     or coalesce((v_pkg.metadata->>'canonical_package')::boolean,false)
     or v_referenced then
    update public.subscription_packages
    set is_active=false,
        status='retired',
        metadata=coalesce(metadata,'{}'::jsonb)
          || jsonb_build_object(
            'retired_at',now(),
            'retired_reason',nullif(left(trim(coalesce(p_reason,'')),500),''),
            'retired_via','it_delete_subscription_package_safe'
          ),
        updated_at=now()
    where id=p_package_id;

    return jsonb_build_object('id',p_package_id,'deleted',false,'retired',true,'referenced',v_referenced);
  end if;

  delete from public.subscription_packages where id=p_package_id;
  return jsonb_build_object('id',p_package_id,'deleted',true,'retired',false,'referenced',false);
end;
$$;

revoke all on function public.it_delete_subscription_package_safe(uuid,text) from public, anon, authenticated;
grant execute on function public.it_delete_subscription_package_safe(uuid,text) to service_role;

-- Update core provisioning to permit reviewed CUSTOM website requests while
-- still creating them with a minimum-safe trial contract first.
CREATE OR REPLACE FUNCTION app.provision_it_store_core_impl(p_request_id uuid, p_actor_user_id uuid, p_internal_code text, p_store_name text, p_owner_name text, p_owner_phone text, p_owner_email text, p_branch_code text, p_branch_name text, p_branch_address text, p_package_id uuid, p_contract_status text DEFAULT 'trial'::text, p_billing_interval text DEFAULT 'monthly'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
  v_now timestamptz := now();
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
  if p_contract_status <> 'trial' then
    raise exception 'paid_activation_requires_approval: Store Provisioning may only start a trial; paid activation must use the existing IT approval flow';
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
  if coalesce(v_package.quota_mode, 'standard') not in ('standard','custom') then
    raise exception 'package_requires_manual_contract: exempt packages cannot be customer-provisioned';
  end if;
  if coalesce(v_package.quota_mode, 'standard') = 'standard'
     and (
       coalesce(v_package.max_branches, 0) < 1
       or coalesce(v_package.max_devices, 0) < 1
       or coalesce(v_package.max_users, 0) < 1
     ) then
    raise exception 'package_invalid_quota: package quota must allow at least one branch, device and user';
  end if;

  -- CUSTOM registrations are reviewed by IT. The core transaction starts with
  -- the minimum safe trial quota; the reviewed per-store terms are applied by
  -- the IT workflow immediately after core provisioning succeeds.
  if coalesce(v_package.quota_mode, 'standard') = 'custom' then
    v_price := 0;
  else
    v_price := case when p_billing_interval = 'yearly' then v_package.yearly_price else v_package.monthly_price end;
    if v_price is null or v_price <= 0 then
      raise exception 'package_billing_interval_unavailable: selected package has no price for this billing interval';
    end if;
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
    'contract_status', 'trial',
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
    case when coalesce(v_package.quota_mode,'standard') = 'custom' then 1 else greatest(1, v_package.max_devices) end,
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
    'trial',
    case when coalesce(v_package.quota_mode,'standard') = 'custom' then 1 else v_package.max_branches end,
    case when coalesce(v_package.quota_mode,'standard') = 'custom' then 1 else v_package.max_devices end,
    case when coalesce(v_package.quota_mode,'standard') = 'custom' then 1 else v_package.max_branches end,
    case when coalesce(v_package.quota_mode,'standard') = 'custom' then 1 else v_package.max_devices end,
    case when coalesce(v_package.quota_mode,'standard') = 'custom' then 1 else v_package.max_users end,
    v_price,
    'THB',
    v_now,
    null,
    jsonb_build_object(
      'source', 'cpipos_it_store_provisioning_p0',
      'package_code', v_package.code,
      'trial_days', 7,
      'paid_activation_requires_it_approval', true
    )
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

  -- The platform subscription baseline defines a 7-day trial and 30-day trial-data retention.
  -- Normalize the tenant-trigger default here so every fast-provisioned store has an enforceable expiry.
  update public.tenant_data_lifecycle
  set lifecycle_status = 'trial',
      data_home = 'primary',
      desired_data_home = 'primary',
      migration_status = 'idle',
      source_home = null,
      target_home = null,
      trial_started_at = coalesce(trial_started_at, v_now),
      trial_expires_at = coalesce(trial_expires_at, coalesce(trial_started_at, v_now) + interval '7 days'),
      grace_until = null,
      archive_after = coalesce(archive_after, coalesce(trial_started_at, v_now) + interval '30 days'),
      retention_until = coalesce(retention_until, coalesce(trial_started_at, v_now) + interval '30 days'),
      access_locked = false,
      lock_reason = null,
      payment_review_status = 'none',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'source', 'cpipos_it_store_provisioning_p0',
        'package_code', v_package.code,
        'trial_days', 7,
        'trial_retention_days', 30,
        'paid_activation_requires_it_approval', true
      )
  where tenant_id = v_tenant.id
  returning * into v_lifecycle;

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
      'max_branches', case when coalesce(v_package.quota_mode,'standard') = 'custom' then 1 else v_package.max_branches end,
      'max_devices', case when coalesce(v_package.quota_mode,'standard') = 'custom' then 1 else v_package.max_devices end,
      'max_users', case when coalesce(v_package.quota_mode,'standard') = 'custom' then 1 else v_package.max_users end,
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
$function$

