-- CpIPOS canonical package catalog reset.
-- Source of truth: approved 2026-08-11 package artwork.
-- Public sale packages after this migration: Starter 350 THB/month, Growth 550 THB/month.
-- 7-day free trial is a system trial policy/data-plane concern, not a paid package row.
--
-- Safety:
-- - Preserve rows that are still referenced by tenant/contracts/history.
-- - Hide those legacy rows from the public catalog instead of corrupting referential history.
-- - Physically delete only obsolete package rows with zero references.

begin;

insert into public.subscription_packages (
  id,
  code,
  name,
  monthly_price,
  yearly_price,
  max_branches,
  max_devices,
  max_products,
  monthly_bill_limit,
  storage_limit_gb,
  retention_months,
  csv_export_enabled,
  is_active,
  status,
  quota_mode,
  display_order,
  metadata,
  updated_at
)
values
(
  coalesce((select id from public.subscription_packages where code='starter'), gen_random_uuid()),
  'starter',
  'Starter',
  350.00,
  0.00,
  1,
  1,
  1000,
  3000,
  3.00,
  6,
  true,
  true,
  'active',
  'standard',
  1,
  jsonb_build_object(
    'public_package', true,
    'canonical_package', true,
    'catalog_revision', '2026-08-11-starter-growth',
    'billing_cycle_days', 30
  ),
  now()
),
(
  coalesce((select id from public.subscription_packages where code='growth'), gen_random_uuid()),
  'growth',
  'Growth',
  550.00,
  0.00,
  1,
  2,
  2000,
  5000,
  5.00,
  12,
  true,
  true,
  'active',
  'standard',
  2,
  jsonb_build_object(
    'public_package', true,
    'canonical_package', true,
    'recommended', true,
    'catalog_revision', '2026-08-11-starter-growth',
    'billing_cycle_days', 30,
    'realtime_sync', true
  ),
  now()
)
on conflict (code) do update
set
  name = excluded.name,
  monthly_price = excluded.monthly_price,
  yearly_price = excluded.yearly_price,
  max_branches = excluded.max_branches,
  max_devices = excluded.max_devices,
  max_products = excluded.max_products,
  monthly_bill_limit = excluded.monthly_bill_limit,
  storage_limit_gb = excluded.storage_limit_gb,
  retention_months = excluded.retention_months,
  csv_export_enabled = excluded.csv_export_enabled,
  is_active = true,
  status = 'active',
  quota_mode = excluded.quota_mode,
  display_order = excluded.display_order,
  metadata = excluded.metadata,
  updated_at = now();

-- All non-canonical packages must disappear from customer-facing package selection.
-- Keep runtime-active legacy references intact until tenant/contract migration is explicitly decided.
update public.subscription_packages sp
set metadata = coalesce(sp.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'public_package', false,
        'canonical_package', false,
        'legacy_reference_only', true,
        'superseded_by', 'starter_growth_2026_08_11'
      ),
    updated_at = now()
where sp.code not in ('starter','growth');

-- Physically remove obsolete package rows only when no live/history table references them.
-- subscription_package_features cascade automatically with the package row.
delete from public.subscription_packages sp
where sp.code not in ('starter','growth')
  and not exists (select 1 from public.tenants t where t.package_id = sp.id)
  and not exists (select 1 from public.tenant_subscription_contracts c where c.package_id = sp.id)
  and not exists (select 1 from public.tenant_billing_cycles b where b.package_id = sp.id)
  and not exists (
    select 1
    from public.tenant_subscription_payment_requests r
    where r.requested_package_id = sp.id
  );

commit;
