-- Enable Bundle Products for the CUSTOM subscription package.
--
-- This migration is intentionally guarded because CpiPOS-001 does not host the
-- subscription catalog tables, while CpiPOS-002 does. It is idempotent and does
-- not change Starter/Growth entitlements.

do $$
begin
  if to_regclass('public.subscription_packages') is not null
     and to_regclass('public.subscription_package_features') is not null then
    execute $sql$
      insert into public.subscription_package_features
        (package_id, feature_code, included, updated_at)
      select id, 'bundle_products', true, now()
      from public.subscription_packages
      where lower(code) = 'custom'
      on conflict (package_id, feature_code)
      do update
         set included = true,
             updated_at = now()
    $sql$;
  end if;
end
$$;
