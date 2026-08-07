-- P0 hotfix: make negative-stock enforcement honor branch_inventory_settings.
--
-- Historical context:
--   chk_ingredients_quantity_non_negative was added before per-branch
--   allow_negative_stock existed. Keeping the global CHECK makes payment
--   completion fail with stock_deduction_failed whenever a branch explicitly
--   allows negative stock and a recipe deduction crosses below zero.
--
-- Safety contract:
--   * missing branch setting => negative stock remains blocked
--   * allow_negative_stock = false => negative stock remains blocked
--   * allow_negative_stock = true  => negative stock is allowed
--   * inserts and any updates (including tenant/branch moves) are guarded

alter table if exists public.ingredients
  drop constraint if exists chk_ingredients_quantity_non_negative;

create or replace function public.enforce_ingredient_negative_stock_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allow_negative_stock boolean := false;
begin
  -- Preserve the former CHECK semantics for NULL and non-negative values.
  if new.quantity_on_hand is null or new.quantity_on_hand >= 0 then
    return new;
  end if;

  select coalesce(s.allow_negative_stock, false)
    into v_allow_negative_stock
  from public.branch_inventory_settings s
  where s.tenant_id = new.tenant_id
    and s.branch_id = new.branch_id
  limit 1;

  if coalesce(v_allow_negative_stock, false) then
    return new;
  end if;

  raise exception using
    errcode = '23514',
    message = format('INSUFFICIENT_STOCK:%s', coalesce(new.id::text, 'unknown'));
end;
$$;

drop trigger if exists trg_ingredients_negative_stock_policy on public.ingredients;

create trigger trg_ingredients_negative_stock_policy
before insert or update on public.ingredients
for each row
execute function public.enforce_ingredient_negative_stock_policy();

comment on function public.enforce_ingredient_negative_stock_policy() is
  'Enforces branch-aware negative stock: only branches with branch_inventory_settings.allow_negative_stock=true may persist quantity_on_hand below zero.';

comment on trigger trg_ingredients_negative_stock_policy on public.ingredients is
  'Replaces the legacy global non-negative CHECK with branch-aware enforcement.';
