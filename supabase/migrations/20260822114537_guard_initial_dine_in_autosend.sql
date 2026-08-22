-- Safety invariant: background POS dine-in kitchen autosend may update an existing
-- queued table order, but it must never create the first order for a table.
-- The first order must come from an explicit cashier submit or a confirmed Table QR submit.

create or replace function app.guard_initial_dine_in_autosend()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app, extensions
as $$
begin
  if new.order_type = 'dine_in'
     and new.table_id is not null
     and coalesce(new.request_id, '') like 'pos-dine-kitchen-%'
     and not exists (
       select 1
       from public.table_bill_sessions s
       where s.tenant_id = new.tenant_id
         and s.branch_id = new.branch_id
         and s.table_id = new.table_id
         and s.status in ('open', 'ordering')
         and s.closed_at is null
         and s.order_id is not null
     ) then
    raise exception 'DINE_IN_AUTOSEND_REQUIRES_EXISTING_ORDER';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_initial_dine_in_autosend on public.orders;
create trigger trg_guard_initial_dine_in_autosend
before insert on public.orders
for each row
execute function app.guard_initial_dine_in_autosend();

revoke all on function app.guard_initial_dine_in_autosend() from public, anon, authenticated;
