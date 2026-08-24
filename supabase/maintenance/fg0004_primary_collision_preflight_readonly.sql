-- FG0004 Primary collision preflight, READ ONLY.
-- Expected before production execution:
-- fg0004_tenant_count=0, fg0004_branch_count=0, fg0004_pos_device_count=0,
-- growth_active_count>=1, registry_table may be null before registry migration.

select
  now() as checked_at,
  current_database() as database_name,
  current_user as checked_by,
  (select count(*) from public.tenants where upper(code) = 'FG0004') as fg0004_tenant_count,
  (select count(*) from public.branches where upper(code) = 'FG0004-RBR-01') as fg0004_branch_count,
  (select count(*) from public.branch_devices where upper(device_code) = 'FG0004-POS-01') as fg0004_pos_device_count,
  (select count(*) from public.subscription_packages where lower(code) = 'growth' and is_active = true and coalesce(status, 'active') = 'active') as growth_active_count,
  to_regclass('app.restaurant_qr_store_registry')::text as restaurant_qr_store_registry,
  case
    when to_regclass('app.restaurant_qr_store_registry') is null then null
    else (xpath('/row/count/text()', query_to_xml(
      'select count(*) from app.restaurant_qr_store_registry where store_code = ''FG0003'' and branch_code = ''FG0003-BKK-01'' and product_profile = ''RESTAURANT_QR'' and enabled = true and status = ''enabled''',
      false,
      true,
      ''
    )))[1]::text::integer
  end as fg0003_registry_enabled_count,
  case
    when to_regclass('app.restaurant_qr_store_registry') is null then null
    else (xpath('/row/count/text()', query_to_xml(
      'select count(*) from app.restaurant_qr_store_registry where store_code = ''FG0004'' or branch_code = ''FG0004-RBR-01''',
      false,
      true,
      ''
    )))[1]::text::integer
  end as fg0004_registry_collision_count,
  (select count(*) from supabase_migrations.schema_migrations where version = '202608240001') as local_schema_migration_version_count,
  (select count(*) from supabase_migrations.schema_migrations where name = 'fg0003_qr_pos_review_lifecycle') as lifecycle_migration_name_count,
  (select count(*) from supabase_migrations.schema_migrations where version = '202608240002') as registry_guard_migration_version_count;