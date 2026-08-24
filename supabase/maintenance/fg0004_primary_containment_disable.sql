-- FG0004 containment disable procedure.
-- SOURCE ONLY / DO NOT EXECUTE unless a future maintenance-window rollback/containment step is explicitly approved.
-- Non-destructive: keeps shared Restaurant QR infrastructure and FG0003 registry intact.

begin;

with fg0004 as (
  select t.id as tenant_id, b.id as branch_id
  from public.tenants t
  join public.branches b on b.tenant_id = t.id
  where upper(t.code) = 'FG0004'
    and upper(b.code) = 'FG0004-RBR-01'
), registry_disabled as (
  update app.restaurant_qr_store_registry r
  set enabled = false,
      status = 'provisioning',
      updated_at = now()
  from fg0004 f
  where r.tenant_id = f.tenant_id
    and r.branch_id = f.branch_id
    and r.store_code = 'FG0004'
  returning r.tenant_id
), branch_disabled as (
  update public.branches b
  set is_active = false,
      updated_at = now()
  from fg0004 f
  where b.id = f.branch_id
  returning b.id
), tenant_disabled as (
  update public.tenants t
  set is_active = false,
      updated_at = now()
  from fg0004 f
  where t.id = f.tenant_id
  returning t.id
), pos_disabled as (
  update public.branch_devices d
  set status = 'inactive',
      is_active = false,
      is_locked = true,
      updated_at = now()
  from fg0004 f
  where d.tenant_id = f.tenant_id
    and d.branch_id = f.branch_id
    and upper(d.device_code) = 'FG0004-POS-01'
  returning d.id
), printers_disabled as (
  update public.printer_profiles pp
  set enabled = false,
      updated_at = now()
  from fg0004 f
  where pp.tenant_id = f.tenant_id
    and pp.branch_id = f.branch_id
    and pp.printer_name in ('RECEIPT-01', 'KITCHEN-01')
  returning pp.id
)
select
  (select count(*) from registry_disabled) as registry_rows,
  (select count(*) from branch_disabled) as branch_rows,
  (select count(*) from tenant_disabled) as tenant_rows,
  (select count(*) from pos_disabled) as pos_rows,
  (select count(*) from printers_disabled) as printer_rows;

commit;