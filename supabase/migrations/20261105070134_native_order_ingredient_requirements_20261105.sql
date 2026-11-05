-- Read the recipe *and* selected modifier ingredient requirements of a queued POS bill.
-- Every row stays tenant/branch scoped. Ledger reconciliation calls this under
-- the locked order transaction; this helper never mutates inventory.
create or replace function app.current_order_ingredient_requirements(
  p_tenant_id uuid,p_branch_id uuid,p_order_id uuid,p_order_type public.order_type
) returns table(ingredient_id uuid, required_qty_grams bigint)
language sql stable
set search_path to 'pg_catalog','public','app','extensions'
as $body$
with base as (
  select r.ingredient_id, sum(round((oi.quantity*r.quantity_per_item)::numeric,0))::bigint grams
  from public.order_items oi
  join public.recipes r on r.product_id=oi.product_id
    and r.tenant_id=p_tenant_id and r.branch_id=p_branch_id
  where oi.order_id=p_order_id and oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id
    and oi.quantity>0 and coalesce(oi.metadata->>'bill_line_state','active')<>'cancelled'
    and (not r.applies_when_takeaway_only or p_order_type in ('takeaway','delivery_manual'))
  group by r.ingredient_id
),
selected as (
  select oi.quantity,oi.product_id,picked.id as option_id
  from public.order_items oi
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(oi.metadata->'native_selection'->'modifier_option_ids')='array'
      then oi.metadata->'native_selection'->'modifier_option_ids' else '[]'::jsonb end
  ) picked(id)
  where oi.order_id=p_order_id and oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id
    and oi.quantity>0 and coalesce(oi.metadata->>'bill_line_state','active')<>'cancelled'
),
modifier as (
  select moi.ingredient_id,
    sum(round((sel.quantity*moi.quantity_delta_per_item)::numeric,0))::bigint grams
  from selected sel
  join public.product_modifier_options o
    on o.id=case when sel.option_id ~* '^[a-f0-9-]{36}$'
      then sel.option_id::uuid else null::uuid end
    and o.tenant_id=p_tenant_id and o.branch_id=p_branch_id
  join public.product_modifier_groups g on g.id=o.group_id
    and g.product_id=sel.product_id and g.tenant_id=p_tenant_id and g.branch_id=p_branch_id
  join public.product_modifier_option_ingredients moi on moi.option_id=o.id
    and moi.tenant_id=p_tenant_id and moi.branch_id=p_branch_id
  group by moi.ingredient_id
)
select ingredient_id, greatest(sum(grams),0)::bigint as required_qty_grams
from (
  select ingredient_id,grams from base
  union all
  select ingredient_id,grams from modifier
) components
group by ingredient_id
$body$;
revoke all on function app.current_order_ingredient_requirements(uuid,uuid,uuid,public.order_type) from public,anon,authenticated;
