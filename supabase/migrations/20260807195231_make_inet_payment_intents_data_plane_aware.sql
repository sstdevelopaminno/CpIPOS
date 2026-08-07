alter table public.pos_payment_intents
  drop constraint if exists pos_payment_intents_order_id_fkey;

create or replace function app.enforce_payment_intent_order_route()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app, extensions
as $$
begin
  if exists (
    select 1
    from public.orders o
    where o.id = new.order_id
      and o.tenant_id = new.tenant_id
      and o.branch_id = new.branch_id
  ) then
    return new;
  end if;

  if exists (
    select 1
    from public.tenant_data_object_routes r
    where r.object_type = 'orders'
      and r.object_id = new.order_id
      and r.tenant_id = new.tenant_id
      and r.branch_id = new.branch_id
  ) then
    return new;
  end if;

  raise exception 'PAYMENT_INTENT_ORDER_ROUTE_MISMATCH:%', new.order_id;
end;
$$;

revoke all on function app.enforce_payment_intent_order_route() from public, anon, authenticated;

drop trigger if exists trg_pos_payment_intents_order_route on public.pos_payment_intents;
create trigger trg_pos_payment_intents_order_route
before insert or update of tenant_id, branch_id, order_id
on public.pos_payment_intents
for each row execute function app.enforce_payment_intent_order_route();

comment on column public.pos_payment_intents.order_id is
  'Order UUID may resolve to CpiPOS-001 or CpiPOS-002. Referential scope is enforced by app.enforce_payment_intent_order_route via primary order or tenant_data_object_routes.';
