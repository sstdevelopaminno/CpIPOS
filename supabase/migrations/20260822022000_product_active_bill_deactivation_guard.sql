-- Prevent live catalog maintenance from invalidating products already referenced by an active POS bill.
-- This targets the FG0003 2026-08-21 product_not_found storm without freezing unrelated catalog work.

create or replace function app.guard_product_deactivation_with_active_bill()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, public, app
as $$
begin
  if coalesce(old.is_active, true) = true and coalesce(new.is_active, true) = false then
    if exists (
      select 1
      from public.order_items oi
      join public.orders o
        on o.id = oi.order_id
       and o.tenant_id = oi.tenant_id
       and o.branch_id = oi.branch_id
      where oi.tenant_id = old.tenant_id
        and oi.branch_id = old.branch_id
        and oi.product_id = old.id
        and coalesce(oi.quantity, 0) > 0
        and lower(coalesce(o.status::text, '')) not in ('completed', 'paid', 'closed', 'cleared', 'cancelled')
    ) then
      raise exception 'PRODUCT_IN_USE_BY_ACTIVE_BILL';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_product_active_bill_deactivation_guard on public.products;
create trigger trg_product_active_bill_deactivation_guard
before update of is_active on public.products
for each row
execute function app.guard_product_deactivation_with_active_bill();
