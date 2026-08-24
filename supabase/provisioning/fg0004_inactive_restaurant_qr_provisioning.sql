-- FG0004 inactive Restaurant QR provisioning transaction for CpiPOS-002 Trial.
-- SOURCE ONLY / DO NOT EXECUTE against Primary.
-- Required order: apply Trial Restaurant QR registry/print-guard migration first, then run this transaction on project kawenyvpentwgugtzqec only.

begin;

-- Preflight and provisioning are intentionally one transaction so any failure rolls back the whole store.
do $$
declare
  v_tenant_id uuid := gen_random_uuid();
  v_branch_id uuid := gen_random_uuid();
  v_table_count integer;
  v_registry_count integer;
  v_printer_slot_count integer;
  v_pos_skeleton_count integer;
begin
  if current_setting('request.jwt.claims', true) is not null then
    raise exception 'FG0004_TRIAL_REHEARSAL_MUST_USE_SERVICE_CONTEXT';
  end if;

  if to_regclass('public.trial_tenant_scopes') is null or to_regclass('public.trial_branch_scopes') is null then
    raise exception 'FG0004_TRIAL_SCOPE_TABLES_MISSING';
  end if;

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

  if exists (
    select 1 from app.restaurant_qr_store_registry
    where store_code = 'FG0004' or branch_code = 'FG0004-RBR-01'
  ) then
    raise exception 'FG0004_REGISTRY_ALREADY_EXISTS';
  end if;

  if exists (
    select 1 from public.trial_tenant_scopes
    where metadata->>'store_code' = 'FG0004'
  ) then
    raise exception 'FG0004_TRIAL_TENANT_ALREADY_EXISTS';
  end if;

  if exists (
    select 1 from public.trial_branch_scopes
    where metadata->>'branch_code' = 'FG0004-RBR-01'
  ) then
    raise exception 'FG0004_TRIAL_BRANCH_ALREADY_EXISTS';
  end if;

  insert into public.trial_tenant_scopes (
    tenant_id, lifecycle_status, is_active, source_control_plane, metadata,
    trial_started_at, trial_expires_at, retention_until, access_locked, lock_reason
  ) values (
    v_tenant_id,
    'trial',
    false,
    'CpiPOS-001',
    jsonb_build_object(
      'store_code', 'FG0004',
      'display_name', 'เลิศรส 108 เมนู',
      'product_profile', 'RESTAURANT_QR',
      'package_code', 'growth',
      'package_name', 'Growth',
      'deployment_mode', 'CENTRAL',
      'update_ring', 'PILOT',
      'provisioning_state', 'inactive/provisioning',
      'source', 'fg0004_trial_rehearsal'
    ),
    now(),
    now() + interval '7 days',
    now() + interval '30 days',
    true,
    'fg0004_trial_rehearsal_inactive'
  );

  insert into public.trial_branch_scopes (
    tenant_id, branch_id, is_active, metadata
  ) values (
    v_tenant_id,
    v_branch_id,
    false,
    jsonb_build_object(
      'store_code', 'FG0004',
      'branch_code', 'FG0004-RBR-01',
      'branch_name', 'เลิศรส 108 เมนู ราชบุรี',
      'province', 'ราชบุรี',
      'provisioning_state', 'inactive/provisioning',
      'pos_skeletons', jsonb_build_array(jsonb_build_object(
        'device_code', 'FG0004-POS-01',
        'device_name', 'FG0004-POS-01',
        'display_mode', 'single_screen',
        'status', 'inactive',
        'android_package', 'com.cpipos.pos',
        'minimum_version_code', 28,
        'mdm_enrolled', false
      )),
      'role_model', jsonb_build_array('OWNER', 'STAFF', 'KITCHEN'),
      'source', 'fg0004_trial_rehearsal'
    )
  );

  insert into public.dining_tables (
    tenant_id, branch_id, table_code, table_name, capacity, status, shape,
    position_x, position_y, width, height, rotation, is_active, metadata
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
    0,
    false,
    jsonb_build_object(
      'source', 'fg0004_trial_rehearsal',
      'qr_generation', 'deferred_until_activation',
      'secure_qr_identity_created', false
    )
  from generate_series(1, 20) as n;

  insert into public.printer_profiles (
    tenant_id, branch_id, printer_name, printer_role, connection_type,
    ip_address, port, paper_width_mm, enabled, metadata
  ) values
  (
    v_tenant_id, v_branch_id, 'RECEIPT-01', 'receipt', 'LOCAL_BRIDGE',
    null, null, 80, false,
    jsonb_build_object('source', 'fg0004_trial_rehearsal', 'slot_only', true, 'hardware_identity', 'TBD', 'automatic_reassignment', false)
  ),
  (
    v_tenant_id, v_branch_id, 'KITCHEN-01', 'kitchen', 'LOCAL_BRIDGE',
    null, null, 80, false,
    jsonb_build_object('source', 'fg0004_trial_rehearsal', 'slot_only', true, 'hardware_identity', 'TBD', 'automatic_reassignment', false)
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

  select count(*) into v_printer_slot_count
  from public.printer_profiles
  where tenant_id = v_tenant_id
    and branch_id = v_branch_id
    and printer_name in ('RECEIPT-01', 'KITCHEN-01')
    and enabled = false;

  if v_printer_slot_count <> 2 then
    raise exception 'FG0004_PRINTER_SLOT_POSTFLIGHT_FAILED_%', v_printer_slot_count;
  end if;

  select jsonb_array_length(coalesce(metadata->'pos_skeletons', '[]'::jsonb)) into v_pos_skeleton_count
  from public.trial_branch_scopes
  where tenant_id = v_tenant_id and branch_id = v_branch_id;

  if v_pos_skeleton_count <> 1 then
    raise exception 'FG0004_POS_SKELETON_POSTFLIGHT_FAILED_%', v_pos_skeleton_count;
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