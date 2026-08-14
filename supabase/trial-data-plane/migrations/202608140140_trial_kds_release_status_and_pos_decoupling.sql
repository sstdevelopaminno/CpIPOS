-- Trial parity for KDS release hotfix: reversible kitchen status and POS/kitchen decoupling.
-- Keeps CpiPOS-002 behavior aligned with the production Primary data plane.

create or replace function app.set_kitchen_ticket_status(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_ticket_id uuid,
  p_status text
)
returns table(ticket_id uuid, ticket_status text, event_type text, updated_at timestamptz)
language plpgsql
security definer
set search_path to 'pg_catalog','public','app','extensions'
as $function$
declare
  v_current text;
  v_next text := lower(btrim(coalesce(p_status, '')));
begin
  if v_next not in ('queued','acknowledged','preparing','ready','cancelled') then raise exception 'KITCHEN_STATUS_INVALID'; end if;
  select kt.status into v_current from public.kitchen_tickets kt
  where kt.id=p_ticket_id and kt.tenant_id=p_tenant_id and kt.branch_id=p_branch_id for update;
  if not found then raise exception 'KITCHEN_TICKET_NOT_FOUND'; end if;
  if v_current=v_next then
    return query select kt.id,kt.status,kt.event_type,kt.updated_at from public.kitchen_tickets kt
    where kt.id=p_ticket_id and kt.tenant_id=p_tenant_id and kt.branch_id=p_branch_id;
    return;
  end if;
  if v_current='cancelled' then raise exception 'KITCHEN_STATUS_TERMINAL'; end if;
  if not (
    (v_current='queued' and v_next in ('acknowledged','preparing','ready','cancelled')) or
    (v_current='acknowledged' and v_next in ('queued','preparing','ready','cancelled')) or
    (v_current='preparing' and v_next in ('acknowledged','ready','cancelled')) or
    (v_current='ready' and v_next='preparing')
  ) then raise exception 'KITCHEN_STATUS_TRANSITION_INVALID'; end if;
  update public.kitchen_tickets kt set status=v_next,updated_at=now()
  where kt.id=p_ticket_id and kt.tenant_id=p_tenant_id and kt.branch_id=p_branch_id;
  return query select kt.id,kt.status,kt.event_type,kt.updated_at from public.kitchen_tickets kt
  where kt.id=p_ticket_id and kt.tenant_id=p_tenant_id and kt.branch_id=p_branch_id;
end;
$function$;

drop trigger if exists trg_orders_kitchen_completion_gate on public.orders;
drop trigger if exists trg_order_items_kitchen_accept_lock on public.order_items;
