-- P0 #410: manual per-item recipe stock deduct/restore must be atomic and idempotent.
-- The POS API validates the authenticated tenant/branch/user; this service-role-only RPC
-- revalidates the scoped order/product/recipe state under database locks, mutates all
-- selected ingredient balances and writes the matching ledger rows in one transaction.

create table if not exists public.pos_item_ingredient_adjustment_requests (
  tenant_id uuid not null,
  branch_id uuid not null,
  request_id text not null,
  order_id uuid not null,
  product_id uuid not null,
  mode text not null check (mode in ('deduct','restore')),
  quantity numeric not null check (quantity > 0),
  ingredient_ids uuid[] not null,
  actor_user_id uuid not null,
  note text,
  created_at timestamptz not null default now(),
  primary key (tenant_id, branch_id, request_id)
);

alter table public.pos_item_ingredient_adjustment_requests enable row level security;
revoke all on public.pos_item_ingredient_adjustment_requests from public, anon, authenticated;
grant select, insert on public.pos_item_ingredient_adjustment_requests to service_role;

create or replace function public.adjust_pos_item_recipe_stock_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_mode text,
  p_ingredient_ids uuid[],
  p_actor_user_id uuid,
  p_request_id text,
  p_note text default null
)
returns table(
  ingredient_id uuid,
  required_grams bigint,
  quantity_delta numeric,
  duplicate_request boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app', 'extensions'
set lock_timeout to '5s'
as $function$
declare
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_selected_ids uuid[];
  v_recipe_ids uuid[];
  v_existing public.pos_item_ingredient_adjustment_requests%rowtype;
  v_allow_negative boolean := false;
  v_reason_base text;
  v_required bigint;
  v_outstanding numeric;
  v_rows integer;
  rec record;
begin
  if p_tenant_id is null or p_branch_id is null or p_order_id is null
     or p_product_id is null or p_actor_user_id is null then
    raise exception 'ADJUSTMENT_SCOPE_REQUIRED';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 9999 then
    raise exception 'INVALID_QUANTITY';
  end if;
  if p_mode not in ('deduct','restore') then
    raise exception 'INVALID_STOCK_MODE';
  end if;
  if p_request_id is null or length(btrim(p_request_id)) < 8 or length(btrim(p_request_id)) > 180 then
    raise exception 'INVALID_REQUEST_KEY';
  end if;

  select array_agg(distinct x order by x)
    into v_selected_ids
  from unnest(coalesce(p_ingredient_ids, array[]::uuid[])) as x;

  if coalesce(cardinality(v_selected_ids),0) = 0 or cardinality(v_selected_ids) > 100 then
    raise exception 'INVALID_INGREDIENT_SELECTION';
  end if;

  insert into public.pos_item_ingredient_adjustment_requests(
    tenant_id, branch_id, request_id, order_id, product_id, mode, quantity,
    ingredient_ids, actor_user_id, note
  )
  values (
    p_tenant_id, p_branch_id, btrim(p_request_id), p_order_id, p_product_id,
    p_mode, p_quantity, v_selected_ids, p_actor_user_id, nullif(btrim(coalesce(p_note,'')),'')
  )
  on conflict (tenant_id, branch_id, request_id) do nothing;

  if not found then
    select *
      into v_existing
    from public.pos_item_ingredient_adjustment_requests r
    where r.tenant_id = p_tenant_id
      and r.branch_id = p_branch_id
      and r.request_id = btrim(p_request_id)
    for update;

    if not found then
      raise exception 'IDEMPOTENCY_STATE_MISSING';
    end if;

    if v_existing.order_id <> p_order_id
       or v_existing.product_id <> p_product_id
       or v_existing.mode <> p_mode
       or v_existing.quantity <> p_quantity
       or v_existing.ingredient_ids <> v_selected_ids
       or coalesce(v_existing.note,'') <> coalesce(nullif(btrim(coalesce(p_note,'')),''),'')
       or v_existing.actor_user_id <> p_actor_user_id then
      raise exception 'IDEMPOTENCY_KEY_REUSED';
    end if;

    return query
    select sm.ingredient_id,
           abs(round(sm.quantity_delta,0))::bigint,
           sm.quantity_delta,
           true
    from public.stock_movements sm
    where sm.tenant_id = p_tenant_id
      and sm.branch_id = p_branch_id
      and sm.ref_table = 'orders'
      and sm.ref_id = p_order_id
      and sm.movement_type = 'sale_deduction'
      and sm.ingredient_id = any(v_selected_ids)
      and sm.request_id = btrim(p_request_id) || ':' || sm.ingredient_id::text
    order by sm.ingredient_id;

    get diagnostics v_rows = row_count;
    if v_rows <> cardinality(v_selected_ids) then
      raise exception 'IDEMPOTENCY_RESULT_INCOMPLETE';
    end if;
    return;
  end if;

  select o.*
    into v_order
  from public.orders o
  where o.id = p_order_id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.status::text = 'cancelled' then
    raise exception 'ORDER_NOT_ADJUSTABLE';
  end if;

  select p.*
    into v_product
  from public.products p
  where p.id = p_product_id
    and p.tenant_id = p_tenant_id
    and p.branch_id = p_branch_id
  for share;

  if not found then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;
  if coalesce(v_product.stock_deduction_mode,'unit_only') <> 'recipe_deduction' then
    raise exception 'PRODUCT_NOT_RECIPE_MODE';
  end if;

  perform 1
  from public.recipes r
  where r.tenant_id = p_tenant_id
    and r.branch_id = p_branch_id
    and r.product_id = p_product_id
  for share;

  select array_agg(distinct r.ingredient_id order by r.ingredient_id)
    into v_recipe_ids
  from public.recipes r
  where r.tenant_id = p_tenant_id
    and r.branch_id = p_branch_id
    and r.product_id = p_product_id
    and r.quantity_per_item > 0
    and (
      not coalesce(r.applies_when_takeaway_only,false)
      or v_order.order_type::text in ('takeaway','delivery_manual')
    );

  if coalesce(cardinality(v_recipe_ids),0) = 0 then
    raise exception 'RECIPE_NOT_FOUND';
  end if;
  if not (v_selected_ids <@ v_recipe_ids) then
    raise exception 'INVALID_INGREDIENT_SELECTION';
  end if;

  perform 1
  from public.ingredients i
  where i.tenant_id = p_tenant_id
    and i.branch_id = p_branch_id
    and i.id = any(v_selected_ids)
  order by i.id
  for update;

  get diagnostics v_rows = row_count;
  if v_rows <> cardinality(v_selected_ids) then
    raise exception 'INGREDIENT_NOT_FOUND';
  end if;

  select coalesce(s.allow_negative_stock,false)
    into v_allow_negative
  from public.branch_inventory_settings s
  where s.tenant_id = p_tenant_id
    and s.branch_id = p_branch_id
  limit 1;
  v_allow_negative := coalesce(v_allow_negative,false);

  for rec in
    select r.ingredient_id,
           round(sum(r.quantity_per_item * p_quantity),0)::bigint as required_grams
    from public.recipes r
    where r.tenant_id = p_tenant_id
      and r.branch_id = p_branch_id
      and r.product_id = p_product_id
      and r.ingredient_id = any(v_selected_ids)
      and r.quantity_per_item > 0
      and (
        not coalesce(r.applies_when_takeaway_only,false)
        or v_order.order_type::text in ('takeaway','delivery_manual')
      )
    group by r.ingredient_id
    order by r.ingredient_id
  loop
    v_required := rec.required_grams;
    if v_required <= 0 then
      raise exception 'INVALID_RECIPE_QUANTITY:%', rec.ingredient_id;
    end if;

    if p_mode = 'deduct' then
      if not v_allow_negative and (
        select i.quantity_on_hand
        from public.ingredients i
        where i.tenant_id=p_tenant_id and i.branch_id=p_branch_id and i.id=rec.ingredient_id
      ) < v_required then
        raise exception 'INSUFFICIENT_STOCK:%', rec.ingredient_id;
      end if;
    else
      select coalesce(-sum(sm.quantity_delta),0)
        into v_outstanding
      from public.stock_movements sm
      where sm.tenant_id = p_tenant_id
        and sm.branch_id = p_branch_id
        and sm.ref_table = 'orders'
        and sm.ref_id = p_order_id
        and sm.movement_type = 'sale_deduction'
        and sm.ingredient_id = rec.ingredient_id
        and right(sm.reason, length(p_product_id::text)+2) = '(' || p_product_id::text || ')';

      if greatest(coalesce(v_outstanding,0),0) < v_required then
        raise exception 'RESTORE_EXCEEDS_DEDUCTED:%', rec.ingredient_id;
      end if;
    end if;
  end loop;

  v_reason_base := coalesce(
    nullif(btrim(coalesce(p_note,'')),''),
    case when p_mode='restore'
      then 'Manual per-item recipe restore from POS bill ' || v_order.order_no
      else 'Manual per-item recipe deduction from POS bill ' || v_order.order_no
    end
  );

  for rec in
    select r.ingredient_id,
           round(sum(r.quantity_per_item * p_quantity),0)::bigint as required_grams
    from public.recipes r
    where r.tenant_id = p_tenant_id
      and r.branch_id = p_branch_id
      and r.product_id = p_product_id
      and r.ingredient_id = any(v_selected_ids)
      and r.quantity_per_item > 0
      and (
        not coalesce(r.applies_when_takeaway_only,false)
        or v_order.order_type::text in ('takeaway','delivery_manual')
      )
    group by r.ingredient_id
    order by r.ingredient_id
  loop
    update public.ingredients i
       set quantity_on_hand = round(
             i.quantity_on_hand +
             case when p_mode='restore' then rec.required_grams else -rec.required_grams end,
             0
           ),
           updated_at = now()
     where i.tenant_id = p_tenant_id
       and i.branch_id = p_branch_id
       and i.id = rec.ingredient_id;

    insert into public.stock_movements(
      tenant_id, branch_id, ingredient_id, movement_type, quantity_delta,
      reason, ref_table, ref_id, created_by, request_id
    )
    values(
      p_tenant_id, p_branch_id, rec.ingredient_id, 'sale_deduction',
      case when p_mode='restore' then rec.required_grams else -rec.required_grams end,
      left(v_reason_base,240) || ' (' || p_product_id::text || ')',
      'orders', p_order_id, p_actor_user_id,
      btrim(p_request_id) || ':' || rec.ingredient_id::text
    );

    ingredient_id := rec.ingredient_id;
    required_grams := rec.required_grams;
    quantity_delta := case when p_mode='restore' then rec.required_grams else -rec.required_grams end;
    duplicate_request := false;
    return next;
  end loop;
end;
$function$;

revoke all on function public.adjust_pos_item_recipe_stock_tx(
  uuid,uuid,uuid,uuid,numeric,text,uuid[],uuid,text,text
) from public, anon, authenticated;
grant execute on function public.adjust_pos_item_recipe_stock_tx(
  uuid,uuid,uuid,uuid,numeric,text,uuid[],uuid,text,text
) to service_role;
