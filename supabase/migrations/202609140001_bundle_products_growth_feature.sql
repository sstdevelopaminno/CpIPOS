-- Bundle Product entitlement for the Growth 550 THB/month package.
-- This is a package-level capability only; it does not mutate tenant/store data.

insert into public.package_feature_catalog (
  code,
  name,
  description,
  default_monthly_price,
  default_yearly_price,
  default_perpetual_price,
  included_by_default,
  priced_per_branch,
  is_active,
  updated_at
)
values (
  'bundle_products',
  'Bundle Products',
  'Create sellable product bundles and deduct stock from the component products through an expanded recipe.',
  0,
  0,
  0,
  false,
  false,
  true,
  now()
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_active = true,
  updated_at = now();

insert into public.subscription_package_features (
  package_id,
  feature_code,
  included,
  custom_monthly_price,
  custom_yearly_price,
  custom_perpetual_price,
  updated_at
)
select
  p.id,
  'bundle_products',
  true,
  null,
  null,
  null,
  now()
from public.subscription_packages p
where p.code = 'growth'
on conflict (package_id, feature_code) do update set
  included = true,
  custom_monthly_price = null,
  custom_yearly_price = null,
  custom_perpetual_price = null,
  updated_at = now();
