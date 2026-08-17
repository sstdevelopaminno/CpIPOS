-- Keep POS/KDS decoupled while making dine-in bill closure terminal for the KDS queue.
-- A dine-in order may be completed without waiting for Kitchen, but once the bill is
-- completed/cancelled it must never reappear if the Kitchen display is later re-enabled.

create or replace function app.finalize_dine_in_kitchen_on_order_terminal()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app', 'extensions'
as $function$
begin
  if new.order_type::text <> 'dine_in'
     or new.status::text not in ('completed', 'cancelled')
     or old.status::text = new.status::text then
    return new;
  end if;

  update public.kitchen_tickets kt
  set
    status = 'cancelled',
    metadata = coalesce(kt.metadata, '{}'::jsonb) || jsonb_build_object(
      'terminalized_by_order_status', new.status::text,
      'terminalized_at', now(),
      'terminalized_source', 'orders_terminal_trigger'
    ),
    updated_at = now()
  where kt.tenant_id = new.tenant_id
    and kt.branch_id = new.branch_id
    and kt.order_id = new.id
    and kt.status in ('queued', 'acknowledged', 'preparing');

  return new;
end;
$function$;

drop trigger if exists trg_orders_finalize_dine_in_kitchen on public.orders;
create trigger trg_orders_finalize_dine_in_kitchen
after update of status on public.orders
for each row
execute function app.finalize_dine_in_kitchen_on_order_terminal();

-- One-time repair for legacy closed dine-in bills that still have active KDS tickets.
update public.kitchen_tickets kt
set
  status = 'cancelled',
  metadata = coalesce(kt.metadata, '{}'::jsonb) || jsonb_build_object(
    'terminalized_by_order_status', o.status::text,
    'terminalized_at', now(),
    'terminalized_source', 'terminal_order_backfill_20260817163000'
  ),
  updated_at = now()
from public.orders o
where o.id = kt.order_id
  and o.tenant_id = kt.tenant_id
  and o.branch_id = kt.branch_id
  and o.order_type::text = 'dine_in'
  and o.status::text in ('completed', 'cancelled')
  and kt.status in ('queued', 'acknowledged', 'preparing');
