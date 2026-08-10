-- CpIPOS canonical public package catalog (2026-08-10)
-- Authoritative commercial baseline:
--   STARTER 350 THB/month
--   GROWTH  550 THB/month
--   CUSTOM  contact/IT configured
-- Trial remains lifecycle-based (7 days) and is not a subscription_packages row.
-- Historical package rows are retained only for FK/contract history, but are
-- retired and hidden from all new package selection/activation flows.
-- Subscription/control-plane tables live on Primary only; Trial has no copy.

begin;

update public.subscription_packages
set name='Starter', monthly_price=350, yearly_price=0,
    max_branches=1, max_devices=1, max_users=4,
    max_products=1000, monthly_bill_limit=3000, storage_limit_gb=3,
    retention_months=6, max_staff_users=2, max_owner_users=1, max_manager_users=1,
    csv_export_enabled=true, tablet_pos_enabled=true, windows_pos_enabled=true,
    mobile_app_enabled=false, quota_mode='standard', display_order=1,
    is_active=true, status='active',
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'public_package',true,'mutable_pricing',true,'billing_cycle_days',30,
      'retention_anchor','first_package_started_at','canonical_package',true
    ), updated_at=now()
where code='starter';

update public.subscription_packages
set name='Growth', monthly_price=550, yearly_price=0,
    max_branches=1, max_devices=2, max_users=9,
    max_products=2000, monthly_bill_limit=5000, storage_limit_gb=5,
    retention_months=12, max_staff_users=5, max_owner_users=2, max_manager_users=2,
    csv_export_enabled=true, tablet_pos_enabled=true, windows_pos_enabled=true,
    mobile_app_enabled=false, quota_mode='standard', display_order=2,
    is_active=true, status='active',
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'public_package',true,'mutable_pricing',true,'billing_cycle_days',30,
      'retention_anchor','first_package_started_at','canonical_package',true
    ), updated_at=now()
where code='growth';

update public.subscription_packages
set name='CUSTOM', monthly_price=0, yearly_price=0,
    max_branches=999999, max_devices=999999, max_users=999999,
    max_products=null, monthly_bill_limit=null, storage_limit_gb=null,
    retention_months=null, max_staff_users=null, max_owner_users=null, max_manager_users=null,
    csv_export_enabled=true, tablet_pos_enabled=true, windows_pos_enabled=true,
    mobile_app_enabled=false, quota_mode='custom', display_order=3,
    is_active=true, status='active',
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'public_package',true,'mutable_pricing',true,'contact_sales',true,
      'billing_cycle_days',30,'canonical_package',true
    ), updated_at=now()
where code='custom';

-- Keep historical rows for FK/contract history, but remove them from use.
update public.subscription_packages
set is_active=false,
    status='retired',
    display_order=null,
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'public_package',false,'canonical_package',false,
      'retired_reason','replaced_by_2026_08_starter_growth_custom'
    ),
    updated_at=now()
where code not in ('starter','growth','custom');

commit;
