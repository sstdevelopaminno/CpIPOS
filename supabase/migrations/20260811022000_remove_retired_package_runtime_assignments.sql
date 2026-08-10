-- Remove obsolete package runtime assignments while preserving historical contract/audit integrity.
-- Canonical commercial packages are only: starter, growth, custom.
-- Trial is lifecycle-based and must not carry a paid/retired package assignment.

begin;

-- Trial tenants must not remain attached to a retired paid package.
update public.tenants t
set package_id = null,
    updated_at = now()
from public.tenant_data_lifecycle l,
     public.subscription_packages p
where l.tenant_id = t.id
  and p.id = t.package_id
  and l.lifecycle_status = 'trial'
  and p.code not in ('starter','growth','custom');

-- Retired-package contracts must not remain active for Trial tenants.
update public.tenant_subscription_contracts c
set status = 'cancelled',
    ended_at = coalesce(c.ended_at, now()),
    updated_at = now(),
    metadata = coalesce(c.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'catalog_cleanup', true,
        'catalog_cleanup_at', now(),
        'catalog_cleanup_reason', 'trial_must_not_use_retired_paid_package'
      )
from public.tenant_data_lifecycle l,
     public.subscription_packages p
where l.tenant_id = c.tenant_id
  and p.id = c.package_id
  and l.lifecycle_status = 'trial'
  and p.code not in ('starter','growth','custom')
  and c.status in ('active','trial');

-- Retired package feature maps are not runtime entitlements anymore.
delete from public.subscription_package_features spf
using public.subscription_packages p
where p.id = spf.package_id
  and p.code not in ('starter','growth','custom');

-- Physically purge obsolete package rows only when no tenant or contract history references them.
-- Referenced rows remain hidden audit stubs; they are not selectable/active packages.
delete from public.subscription_packages p
where p.code not in ('starter','growth','custom')
  and not exists (select 1 from public.tenants t where t.package_id = p.id)
  and not exists (select 1 from public.tenant_subscription_contracts c where c.package_id = p.id);

-- Any referenced legacy rows that remain are audit-only stubs.
update public.subscription_packages p
set is_active = false,
    status = 'retired',
    display_order = null,
    metadata = (coalesce(p.metadata, '{}'::jsonb)
      - 'public_package' - 'canonical_package')
      || jsonb_build_object(
        'public_package', false,
        'canonical_package', false,
        'catalog_hidden', true,
        'audit_history_only', true,
        'runtime_entitlements_removed', true
      ),
    updated_at = now()
where p.code not in ('starter','growth','custom');

commit;
