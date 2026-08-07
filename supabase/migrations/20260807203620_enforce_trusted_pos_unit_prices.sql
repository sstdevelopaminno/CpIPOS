create or replace function app.enforce_trusted_pos_unit_price()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_order_type public.order_type;
  v_catalog_price numeric(12,2);
begin
  select o.order_type
    into v_order_type
  from public.orders o
  where o.id = new.order_id
    and o.tenant_id = new.tenant_id
    and o.branch_id = new.branch_id;

  if v_order_type is null then
    raise exception 'ORDER_SCOPE_NOT_FOUND';
  end if;

  if v_order_type <> 'delivery_manual'::public.order_type then
    select round(p.price::numeric, 2)
      into v_catalog_price
    from public.products p
    where p.id = new.product_id
      and p.tenant_id = new.tenant_id
      and p.branch_id = new.branch_id
      and p.is_active = true;

    if v_catalog_price is null then
      raise exception 'PRODUCT_NOT_FOUND:%', new.product_id;
    end if;

    if abs(round(new.unit_price::numeric, 2) - v_catalog_price) > 0.01 then
      raise exception 'UNTRUSTED_UNIT_PRICE:%', new.product_id;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function app.enforce_trusted_pos_unit_price() from public, anon, authenticated;
grant execute on function app.enforce_trusted_pos_unit_price() to service_role;

drop trigger if exists trg_order_items_trusted_unit_price on public.order_items;
create trigger trg_order_items_trusted_unit_price
before insert or update of tenant_id, branch_id, order_id, product_id, unit_price
on public.order_items
for each row
execute function app.enforce_trusted_pos_unit_price();
