-- Route all order ingress paths (POS, Table, QR) through the same Kitchen core.
-- Statement-level item trigger groups one insert batch into one event per order,
-- avoiding a separate kitchen ticket for each line item.

create or replace function app.route_inserted_order_items_to_kitchen()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_batch record;
  v_action text;
begin
  for v_batch in
    select
      ni.tenant_id,
      ni.branch_id,
      ni.order_id,
      array_agg(ni.id order by ni.id) as item_ids,
      md5(string_agg(ni.id::text, ',' order by ni.id)) as item_hash
    from new_order_items ni
    group by ni.tenant_id, ni.branch_id, ni.order_id
  loop
    if exists (
      select 1
      from order_items oi
      where oi.tenant_id = v_batch.tenant_id
        and oi.branch_id = v_batch.branch_id
        and oi.order_id = v_batch.order_id
        and not (oi.id = any(v_batch.item_ids))
    ) then
      v_action := 'add';
    else
      v_action := 'new';
    end if;

    perform *
    from app.enqueue_kitchen_order(
      v_batch.tenant_id,
      v_batch.branch_id,
      v_batch.order_id,
      'order:' || v_batch.order_id::text || ':items:' || v_batch.item_hash,
      v_action,
      v_batch.item_ids
    );
  end loop;
  return null;
end;
$$;

create or replace function app.route_cancelled_order_to_kitchen()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
begin
  if new.status::text = 'cancelled' and old.status::text is distinct from 'cancelled' then
    perform *
    from app.enqueue_kitchen_order(
      new.tenant_id,
      new.branch_id,
      new.id,
      'order:' || new.id::text || ':cancel',
      'cancel',
      null
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_order_items_kitchen_route on order_items;
create trigger trg_order_items_kitchen_route
after insert on order_items
referencing new table as new_order_items
for each statement
execute function app.route_inserted_order_items_to_kitchen();

drop trigger if exists trg_order_cancel_kitchen_route on orders;
create trigger trg_order_cancel_kitchen_route
after update of status on orders
for each row
execute function app.route_cancelled_order_to_kitchen();

revoke all on function app.route_inserted_order_items_to_kitchen() from public, anon, authenticated;
revoke all on function app.route_cancelled_order_to_kitchen() from public, anon, authenticated;
grant execute on function app.route_inserted_order_items_to_kitchen() to service_role;
grant execute on function app.route_cancelled_order_to_kitchen() to service_role;
