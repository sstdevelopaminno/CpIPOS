-- CpIPOS canonical package catalog (2026-08-11)
-- Authoritative commercial baseline:
--   STARTER 350 THB/month
--   GROWTH  550 THB/month
--   CUSTOM  contact sales / IT configured to the customer's business needs
-- Trial remains lifecycle-based (7 days) and is not a subscription_packages row.
--
-- Package + device governance:
-- - STARTER/GROWTH use package-defined terminal quotas.
-- - CUSTOM is negotiated and its effective branch/device limits are controlled by
--   the active tenant contract in IT Admin; package-level large values are only a
--   compatibility ceiling and must not be treated as the negotiated entitlement.
-- - Tablet/Windows POS devices remain registered-device scoped and MDM/IT managed.
-- - Historical package rows are not selectable. Rows still referenced by contract
--   or audit history remain retired reference records so FK/history is preserved.
-- Subscription/control-plane tables live on Primary only; Trial has no paid catalog copy.

begin;

update public.subscription_packages
set name='Starter', monthly_price=350, yearly_price=0,
    max_branches=1, max_devices=1, max_users=4,
    max_products=1000, monthly_bill_limit=3000, storage_limit_gb=3,
    retention_months=6, max_staff_users=2, max_owner_users=1, max_manager_users=1,
    csv_export_enabled=true, tablet_pos_enabled=true, windows_pos_enabled=true,
    mobile_app_enabled=false, quota_mode='standard', display_order=1,
    is_active=true, status='active',
    metadata=(coalesce(metadata,'{}'::jsonb)
      - 'legacy_reference_only' - 'superseded_by' - 'retired_reason')
      || jsonb_build_object(
        'public_package',true,
        'canonical_package',true,
        'catalog_revision','2026-08-11-starter-growth-custom',
        'billing_cycle_days',30,
        'device_quota_source','package',
        'registered_device_required',true,
        'it_admin_device_control',true,
        'mdm_managed',true
      ),
    updated_at=now()
where code='starter';

update public.subscription_packages
set name='Growth', monthly_price=550, yearly_price=0,
    max_branches=1, max_devices=2, max_users=9,
    max_products=2000, monthly_bill_limit=5000, storage_limit_gb=5,
    retention_months=12, max_staff_users=5, max_owner_users=2, max_manager_users=2,
    csv_export_enabled=true, tablet_pos_enabled=true, windows_pos_enabled=true,
    mobile_app_enabled=false, quota_mode='standard', display_order=2,
    is_active=true, status='active',
    metadata=(coalesce(metadata,'{}'::jsonb)
      - 'legacy_reference_only' - 'superseded_by' - 'retired_reason')
      || jsonb_build_object(
        'public_package',true,
        'canonical_package',true,
        'recommended',true,
        'realtime_sync',true,
        'catalog_revision','2026-08-11-starter-growth-custom',
        'billing_cycle_days',30,
        'device_quota_source','package',
        'registered_device_required',true,
        'it_admin_device_control',true,
        'mdm_managed',true
      ),
    updated_at=now()
where code='growth';

update public.subscription_packages
set name='CUSTOM', monthly_price=0, yearly_price=0,
    -- Compatibility ceilings only. The negotiated CUSTOM entitlement must come
    -- from tenant_subscription_contracts / IT Admin, not from these ceiling values.
    max_branches=999999, max_devices=999999, max_users=999999,
    max_products=null, monthly_bill_limit=null, storage_limit_gb=null,
    retention_months=null, max_staff_users=null, max_owner_users=null, max_manager_users=null,
    csv_export_enabled=true, tablet_pos_enabled=true, windows_pos_enabled=true,
    mobile_app_enabled=false, quota_mode='custom', display_order=3,
    is_active=true, status='active',
    metadata=(coalesce(metadata,'{}'::jsonb)
      - 'legacy_reference_only' - 'superseded_by' - 'retired_reason')
      || jsonb_build_object(
        'public_package',true,
        'canonical_package',true,
        'contact_sales',true,
        'custom_contract_required',true,
        'it_admin_managed',true,
        'device_quota_source','tenant_contract',
        'registered_device_required',true,
        'it_admin_device_control',true,
        'mdm_managed',true,
        'tablet_pos_managed',true,
        'catalog_revision','2026-08-11-starter-growth-custom'
      ),
    updated_at=now()
where code='custom';

-- Remove every old package from all current selection/activation paths.
-- Physical deletion is intentionally not used for rows that are FK-referenced by
-- historical contracts/audit records. They are not current packages anymore.
update public.subscription_packages
set is_active=false,
    status='retired',
    display_order=null,
    metadata=(coalesce(metadata,'{}'::jsonb)
      - 'public_package' - 'canonical_package')
      || jsonb_build_object(
        'public_package',false,
        'canonical_package',false,
        'catalog_hidden',true,
        'audit_history_only',true,
        'retired_reason','replaced_by_2026_08_starter_growth_custom'
      ),
    updated_at=now()
where code not in ('starter','growth','custom');

commit;
