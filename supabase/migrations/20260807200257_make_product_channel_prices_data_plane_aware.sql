alter table public.product_channel_prices
  drop constraint if exists product_channel_prices_product_id_fkey;

create or replace function app.enforce_product_channel_price_product_route()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app, extensions
as $$
begin
  if exists (
    select 1
    from public.products p
    where p.id = new.product_id
      and p.tenant_id = new.tenant_id
      and p.branch_id = new.branch_id
  ) then
    return new;
  end if;

  if exists (
    select 1
    from public.tenant_data_object_routes r
    where r.object_type = 'products'
      and r.object_id = new.product_id
      and r.tenant_id = new.tenant_id
      and r.branch_id = new.branch_id
  ) then
    return new;
  end if;

  raise exception 'PRODUCT_CHANNEL_PRICE_ROUTE_MISMATCH:%', new.product_id;
end;
$$;

revoke all on function app.enforce_product_channel_price_product_route() from public, anon, authenticated;

drop trigger if exists trg_product_channel_prices_product_route on public.product_channel_prices;
create trigger trg_product_channel_prices_product_route
before insert or update of tenant_id, branch_id, product_id
on public.product_channel_prices
for each row execute function app.enforce_product_channel_price_product_route();

comment on column public.product_channel_prices.product_id is
  'Product UUID may resolve to CpiPOS-001 or CpiPOS-002. Scope is enforced through Primary product or tenant_data_object_routes.';
