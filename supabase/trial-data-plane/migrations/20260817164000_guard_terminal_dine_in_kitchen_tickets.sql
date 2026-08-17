-- Trial data-plane mirror: prevent late active Kitchen tickets after a dine-in bill is terminal.

create or replace function app.guard_terminal_dine_in_kitchen_ticket()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app', 'extensions'
as $function$
declare
  v_order_status text;
begin
  if new.status not in ('queued', 'acknowledged', 'preparing') then
    return new;
  end if;

  select o.status::text
    into v_order_status
  from public.orders o
  where o.id = new.order_id
    and o.tenant_id = new.tenant_id
    and o.branch_id = new.branch_id
    and o.order_type::text = 'dine_in';

  if found and v_order_status in ('completed', 'cancelled') then
    new.status := 'cancelled';
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'terminalized_by_order_status', v_order_status,
      'terminalized_at', now(),
      'terminalized_source', 'kitchen_ticket_terminal_guard'
    );
    new.updated_at := now();
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_kitchen_ticket_terminal_dine_in_guard on public.kitchen_tickets;
create trigger trg_kitchen_ticket_terminal_dine_in_guard
before insert or update of status on public.kitchen_tickets
for each row
execute function app.guard_terminal_dine_in_kitchen_ticket();
