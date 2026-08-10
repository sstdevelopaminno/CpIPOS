-- Keep the Primary control-plane object-route registry in sync for anonymous
-- Table QR sessions. submit_table_qr_order_tx resolves its authoritative data
-- plane from this registry before the business RPC is executed.

create or replace function app.register_primary_table_qr_object_route()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
begin
  if exists (
    select 1
    from public.tenant_data_lifecycle lifecycle
    where lifecycle.tenant_id = new.tenant_id
      and lifecycle.data_home = 'primary'
  ) then
    insert into public.tenant_data_object_routes (
      object_type,
      object_id,
      tenant_id,
      branch_id,
      metadata
    ) values (
      'table_qr_sessions',
      new.id,
      new.tenant_id,
      new.branch_id,
      jsonb_build_object(
        'source', 'table_qr_session_trigger',
        'source_home', 'primary'
      )
    )
    on conflict (object_type, object_id) do update
    set tenant_id = excluded.tenant_id,
        branch_id = excluded.branch_id,
        updated_at = now(),
        metadata = coalesce(public.tenant_data_object_routes.metadata, '{}'::jsonb) || excluded.metadata;
  end if;

  return new;
end;
$$;

revoke all on function app.register_primary_table_qr_object_route() from public, anon, authenticated;

comment on function app.register_primary_table_qr_object_route() is
  'Registers Primary-owned table QR sessions in the control-plane object-route registry for anonymous business RPC routing.';

drop trigger if exists trg_register_primary_table_qr_object_route on public.table_qr_sessions;
create trigger trg_register_primary_table_qr_object_route
after insert on public.table_qr_sessions
for each row
execute function app.register_primary_table_qr_object_route();

-- Repair sessions created while route registration was missing. Restrict the
-- backfill to tenants whose authoritative data home is currently Primary.
insert into public.tenant_data_object_routes (
  object_type,
  object_id,
  tenant_id,
  branch_id,
  metadata
)
select
  'table_qr_sessions',
  qr.id,
  qr.tenant_id,
  qr.branch_id,
  jsonb_build_object(
    'source', 'table_qr_object_route_backfill',
    'source_home', 'primary'
  )
from public.table_qr_sessions qr
join public.tenant_data_lifecycle lifecycle
  on lifecycle.tenant_id = qr.tenant_id
 and lifecycle.data_home = 'primary'
on conflict (object_type, object_id) do update
set tenant_id = excluded.tenant_id,
    branch_id = excluded.branch_id,
    updated_at = now(),
    metadata = coalesce(public.tenant_data_object_routes.metadata, '{}'::jsonb) || excluded.metadata;

notify pgrst, 'reload schema';
