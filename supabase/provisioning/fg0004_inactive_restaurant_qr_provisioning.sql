-- FG0004 inactive Restaurant QR provisioning transaction.
-- SOURCE ONLY / DO NOT EXECUTE until an explicit maintenance-window approval.
-- Required order: apply Restaurant QR registry/print-guard migration first, then run this transaction.

begin;

-- Preflight and provisioning are intentionally one transaction so any failure rolls back the whole store.
do $$
declare
  v_tenant_id uuid := gen_random_uuid();
  v_branch_id uuid := gen_random_uuid();
  v_pos_device_id uuid := gen_random_uuid();
  v_growth_package_id uuid;
  v_table_count integer;
  v_registry_count integer;
begin
  if to_regclass('app.restaurant_qr_store_registry') is null then
    raise exception 'FG0004_RESTAURANT_QR_REGISTRY_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'app'
      and table_name = 'restaurant_qr_store_registry'
      and column_name = 'enabled'
  ) then
    raise exception 'FG0004_RESTAURANT_QR_REGISTRY_ENABLED_COLUMN_MISSING';
  end if;

  select p.id
    into v_growth_package_id
  from public.subscription_packages p
  where lower(p.code) = 'growth'
    and p.is_active = true
    and coalesce(p.status, 'active') = 'active'
  order by p.created_at desc
  limit 1;

  if v_growth_package_id is null then
    raise exception 'FG0004_GROWTH_PACKAGE_NOT_ACTIVE';
  end if;

  if exists (select 1 from public.tenants where upper(code) = 'FG0004') then
    raise exception 'FG0004_TENANT_ALREADY_EXISTS';
  end if;

  if exists (select 1 from public.branches where upper(code) = 'FG0004-RBR-01') then
    raise exception 'FG0004_BRANCH_ALREADY_EXISTS';
  end if;

  if exists (select 1 from public.branch_devices where upper(device_code) = 'FG0004-POS-01') then
    raise exception 'FG0004_POS_DEVICE_ALREADY_EXISTS';
  end if;

  insert into public.tenants (id, code, name, owner_name, owner_phone, package_id, is_active)
  values (v_tenant_id, 'FG0004', 'เลิศรส 108 เมนู', null, null, v_growth_package_id, false);

  insert into public.branches (id, tenant_id, code, name, address, is_active)
  values (v_branch_id, v_tenant_id, 'FG0004-RBR-01', 'เลิศรส 108 เมนู ราชบุรี', 'ราชบุรี', false);

  insert into public.dining_tables (
    tenant_id, branch_id, table_code, table_name, capacity, status, shape,
    position_x, position_y, width, height, is_active, metadata
  )
  select
    v_tenant_id,
    v_branch_id,
    'T' || lpad(n::text, 2, '0'),
    'T' || lpad(n::text, 2, '0'),
    4,
    'disabled',
    'rectangle',
    ((n - 1) % 5) * 120,
    floor((n - 1) / 5) * 96,
    96,
    72,
    false,
    jsonb_build_object(
      'source', 'fg0004_inactive_restaurant_qr_provisioning',
      'qr_generation', 'deferred_until_activation',
      'secure_qr_identity_created', false
    )
  from generate_series(1, 20) as n;

  insert into public.branch_devices (
    id, tenant_id, branch_id, device_code, device_name, device_type, status,
    is_locked, allow_morning_shift, allow_afternoon_shift, metadata
  ) values (
    v_pos_device_id,
    v_tenant_id,
    v_branch_id,
    'FG0004-POS-01',
    'FG0004-POS-01',
    'pos_terminal',
    'inactive',
    true,
    true,
    true,
    jsonb_build_object(
      'source', 'fg0004_inactive_restaurant_qr_provisioning',
      'android_package', 'com.cpipos.pos',
      'minimum_version_code', 28,
      'display_mode', 'single_screen',
      'mdm_enrolled', false
    )
  );

  insert into app.restaurant_qr_store_registry (
    tenant_id, branch_id, store_code, branch_code, display_name, product_profile,
    deployment_mode, update_ring, package_code, enabled, status
  ) values (
    v_tenant_id,
    v_branch_id,
    'FG0004',
    'FG0004-RBR-01',
    'เลิศรส 108 เมนู',
    'RESTAURANT_QR',
    'CENTRAL',
    'PILOT',
    'growth',
    false,
    'provisioning'
  );

  select count(*) into v_table_count
  from public.dining_tables
  where tenant_id = v_tenant_id
    and branch_id = v_branch_id
    and table_code between 'T01' and 'T20';

  if v_table_count <> 20 then
    raise exception 'FG0004_TABLE_POSTFLIGHT_FAILED_%', v_table_count;
  end if;

  select count(*) into v_registry_count
  from app.restaurant_qr_store_registry
  where tenant_id = v_tenant_id
    and branch_id = v_branch_id
    and store_code = 'FG0004'
    and branch_code = 'FG0004-RBR-01'
    and product_profile = 'RESTAURANT_QR'
    and enabled = false
    and status = 'provisioning';

  if v_registry_count <> 1 then
    raise exception 'FG0004_REGISTRY_POSTFLIGHT_FAILED_%', v_registry_count;
  end if;

  if exists (
    select 1 from public.table_qr_sessions
    where tenant_id = v_tenant_id or branch_id = v_branch_id
  ) then
    raise exception 'FG0004_QR_SESSION_SHOULD_NOT_EXIST';
  end if;
end $$;

commit;