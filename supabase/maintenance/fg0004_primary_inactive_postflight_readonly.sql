-- FG0004 Primary inactive provisioning postflight, READ ONLY.
-- Expected after future provisioning: tenant=1, branch=1, tables=20, POS=1, printer_slots=2, registry disabled/provisioning=1, runtime_enabled=false.

with fg0004 as (
  select t.id as tenant_id, b.id as branch_id
  from public.tenants t
  join public.branches b on b.tenant_id = t.id
  where upper(t.code) = 'FG0004'
    and upper(b.code) = 'FG0004-RBR-01'
)
select
  now() as checked_at,
  (select count(*) from public.tenants where upper(code) = 'FG0004') as tenant_count,
  (select count(*) from public.branches where upper(code) = 'FG0004-RBR-01') as branch_count,
  (select count(*) from public.dining_tables dt join fg0004 f on f.tenant_id = dt.tenant_id and f.branch_id = dt.branch_id where dt.table_code between 'T01' and 'T20') as table_count,
  (select count(*) from public.branch_devices d join fg0004 f on f.tenant_id = d.tenant_id and f.branch_id = d.branch_id where upper(d.device_code) = 'FG0004-POS-01' and d.status = 'inactive') as pos_skeleton_count,
  (select count(*) from public.printer_profiles pp join fg0004 f on f.tenant_id = pp.tenant_id and f.branch_id = pp.branch_id where pp.printer_name in ('RECEIPT-01', 'KITCHEN-01') and pp.enabled = false) as disabled_printer_slot_count,
  case
    when to_regclass('app.restaurant_qr_store_registry') is null then null
    else (xpath('/row/count/text()', query_to_xml(
      'select count(*) from app.restaurant_qr_store_registry where store_code = ''FG0004'' and branch_code = ''FG0004-RBR-01'' and product_profile = ''RESTAURANT_QR'' and enabled = false and status = ''provisioning''',
      false,
      true,
      ''
    )))[1]::text::integer
  end as disabled_registry_count,
  case
    when to_regprocedure('app.is_restaurant_qr_scope(uuid,uuid)') is null then null
    when not exists (select 1 from fg0004) then null
    else (select app.is_restaurant_qr_scope(tenant_id, branch_id) from fg0004 limit 1)
  end as runtime_qr_enabled;