create or replace function app.provision_tenant_lifecycle_defaults()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_access_code text;
  v_attempt integer := 0;
begin
  if not exists (
    select 1 from public.tenant_access_codes where tenant_id = new.id
  ) then
    loop
      v_attempt := v_attempt + 1;
      if v_attempt > 32 then
        raise exception using errcode = '23505', message = 'tenant_access_code_allocation_exhausted';
      end if;

      v_access_code := (100000 + floor(random() * 700000)::integer)::text;
      begin
        insert into public.tenant_access_codes (tenant_id, access_code, purpose, is_active, metadata)
        values (
          new.id,
          v_access_code,
          'customer',
          true,
          jsonb_build_object('legacy_code', new.code, 'allocation', 'tenant_insert_trigger')
        );
        exit;
      exception when unique_violation then
        null;
      end;
    end loop;
  end if;

  insert into public.tenant_data_lifecycle (
    tenant_id,
    lifecycle_status,
    data_home,
    desired_data_home,
    migration_status,
    source_home,
    target_home,
    trial_started_at,
    metadata
  )
  values (
    new.id,
    'trial',
    'primary',
    'trial',
    'planned',
    'primary',
    'trial',
    now(),
    jsonb_build_object('legacy_code', new.code, 'allocation', 'tenant_insert_trigger')
  )
  on conflict (tenant_id) do nothing;

  return new;
end;
$$;

revoke all on function app.provision_tenant_lifecycle_defaults() from public, anon, authenticated;
grant execute on function app.provision_tenant_lifecycle_defaults() to service_role;

drop trigger if exists trg_tenant_lifecycle_defaults on public.tenants;
create trigger trg_tenant_lifecycle_defaults
after insert on public.tenants
for each row execute function app.provision_tenant_lifecycle_defaults();

comment on function app.provision_tenant_lifecycle_defaults() is 'Creates the immutable six-digit customer access code and safe trial lifecycle row atomically whenever a new tenant is inserted. Current data_home remains primary until the verified Trial data plane is activated.';
