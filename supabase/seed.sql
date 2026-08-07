-- CpIPOS default seed is intentionally tenant-neutral.
--
-- Production and shared environments must not recreate hard-coded demo tenants,
-- branches, devices, users, passwords, PINs, orders, products, or inventory when
-- `supabase db reset` is executed.
--
-- Subscription packages and the feature catalog are migration-managed under
-- `supabase/migrations/` and therefore do not belong in the default tenant seed.
--
-- If temporary local/demo fixtures are required in the future, keep them in an
-- explicit opt-in fixture script outside the default reset path and never reuse
-- production tenant codes or credentials.

select 1;
