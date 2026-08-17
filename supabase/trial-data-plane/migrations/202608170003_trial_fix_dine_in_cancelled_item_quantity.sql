-- Trial data-plane mirror of 202608170003_fix_dine_in_cancelled_item_quantity.sql.
-- Keep Primary and Trial dine-in order-item cancellation semantics identical.

create or replace function app.enforce_non_delivery_catalog_unit_price()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'app', 'extensions'
as $function$
declare
  v_order_type public.order_type;
  v_catalog_price numeric;
begin
  if new.quantity is null or new.quantity < 0 then
    raise exception 'INVALID_ITEM_QTY';
  end if;

  if new.quantity = 0 then
    if tg_op <> 'UPDATE' then
      raise exception 'INVALID_ITEM_QTY';
    end if;

    if old.quantity is null
      or old.quantity <= 0
      or coalesce(new.metadata->>'bill_line_state', '') <> 'cancelled'
      or new.tenant_id is distinct from old.tenant_id
      or new.branch_id is distinct from old.branch_id
      or new.order_id is distinct from old.order_id
      or new.product_id is distinct from old.product_id
      or new.unit_price is distinct from old.unit_price
    then
      raise exception 'INVALID_ITEM_QTY';
    end if;

    new.line_total := 0;
    return new;
  end if;

  select o.order_type
    into v_order_type
  from public.orders o
  where o.id = new.order_id
    and o.tenant_id = new.tenant_id
    and o.branch_id = new.branch_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND_FOR_ITEM';
  end if;

  select p.price
    into v_catalog_price
  from public.products p
  where p.id = new.product_id
    and p.tenant_id = new.tenant_id
    and p.branch_id = new.branch_id
    and p.is_active = true;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND:%', new.product_id;
  end if;

  if v_order_type <> 'delivery_manual'::public.order_type then
    if new.unit_price is null or abs(round(new.unit_price::numeric, 2) - round(v_catalog_price::numeric, 2)) > 0.01 then
      raise exception 'UNTRUSTED_UNIT_PRICE:%', new.product_id;
    end if;
    new.unit_price := round(v_catalog_price::numeric, 2);
    new.line_total := round(new.unit_price * new.quantity, 2);
  else
    if new.unit_price is null or new.unit_price < 0 then
      raise exception 'INVALID_ITEM_UNIT_PRICE';
    end if;
    new.unit_price := round(new.unit_price::numeric, 2);
    new.line_total := round(new.unit_price * new.quantity, 2);
  end if;

  return new;
end;
$function$;
