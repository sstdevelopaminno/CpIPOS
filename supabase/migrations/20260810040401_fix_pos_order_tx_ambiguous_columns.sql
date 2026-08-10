create or replace function app.create_pos_order_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_shift_id uuid,
  p_created_by uuid,
  p_order_type order_type,
  p_channel text,
  p_table_id uuid,
  p_external_order_code text,
  p_customer_name text,
  p_notes text,
  p_app_total_amount numeric,
  p_discount_amount numeric,
  p_gp_amount numeric,
  p_delivery_pricing_channel text default null,
  p_delivery_app_subtotal numeric default null,
  p_delivery_commission_rate_pct numeric default null,
  p_delivery_commission_amount numeric default null,
  p_delivery_commission_vat_rate_pct numeric default null,
  p_delivery_commission_vat_amount numeric default null,
  p_delivery_platform_fee_amount numeric default null,
  p_delivery_net_payout_amount numeric default null,
  p_delivery_pricing_source_url text default null,
  p_delivery_pricing_note text default null,
  p_items jsonb default '[]'::jsonb,
  p_request_id text default null,
  p_order_no text default null
)
returns table(
  order_id uuid,
  order_no text,
  order_status text,
  created_at timestamptz,
  duplicate_request boolean
)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_existing_order record;
  v_order_id uuid;
  v_order_no text;
  v_subtotal numeric(12,2);
  v_discount numeric(12,2);
  v_gp numeric(12,2);
  v_total numeric(12,2);
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric(12,3);
  v_unit_price numeric(12,2);
  v_line_total numeric(12,2);
  v_input_unit_price numeric(12,2);
  v_prefix text;
  v_allow_negative_stock boolean := false;
  rec record;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ORDER_ITEMS_REQUIRED';
  end if;

  if p_request_id is not null then
    select o.id, o.order_no, o.status, o.created_at
    into v_existing_order
    from public.orders o
    where o.tenant_id = p_tenant_id
      and o.branch_id = p_branch_id
      and o.request_id = p_request_id
    limit 1;

    if found then
      return query
      select v_existing_order.id, v_existing_order.order_no, v_existing_order.status::text, v_existing_order.created_at, true;
      return;
    end if;
  end if;

  if p_order_type not in ('dine_in', 'takeaway', 'delivery_manual') then
    raise exception 'INVALID_ORDER_TYPE';
  end if;

  if not exists (
    select 1
    from shifts s
    where s.id = p_shift_id
      and s.tenant_id = p_tenant_id
      and s.branch_id = p_branch_id
      and s.status = 'open'
  ) then
    raise exception 'SHIFT_NOT_OPEN';
  end if;

  select coalesce(s.allow_negative_stock, false)
  into v_allow_negative_stock
  from branch_inventory_settings s
  where s.tenant_id = p_tenant_id
    and s.branch_id = p_branch_id
  limit 1;

  v_subtotal := round(coalesce(p_app_total_amount, 0)::numeric, 2);
  v_discount := round(greatest(coalesce(p_discount_amount, 0), 0)::numeric, 2);
  v_gp := round(greatest(coalesce(p_gp_amount, 0), 0)::numeric, 2);
  v_total := round(v_subtotal - v_discount - v_gp, 2);

  if v_total < 0 then
    raise exception 'NEGATIVE_ORDER_TOTAL';
  end if;

  v_prefix := case p_order_type
    when 'dine_in' then 'DIN'
    when 'takeaway' then 'TKO'
    else 'DLV'
  end;

  v_order_id := gen_random_uuid();
  v_order_no := coalesce(
    p_order_no,
    format('%s-%s-%s', v_prefix, to_char(now(), 'YYYYMMDDHH24MISSMS'), substr(replace(v_order_id::text, '-', ''), 1, 6))
  );

  insert into orders (
    id,
    tenant_id,
    branch_id,
    shift_id,
    order_no,
    order_type,
    channel,
    delivery_status,
    table_id,
    external_order_code,
    customer_name,
    notes,
    subtotal,
    discount_amount,
    gp_amount,
    delivery_pricing_channel,
    delivery_app_subtotal,
    delivery_commission_rate_pct,
    delivery_commission_amount,
    delivery_commission_vat_rate_pct,
    delivery_commission_vat_amount,
    delivery_platform_fee_amount,
    delivery_net_payout_amount,
    delivery_pricing_source_url,
    delivery_pricing_note,
    total_amount,
    status,
    created_by,
    request_id
  )
  values (
    v_order_id,
    p_tenant_id,
    p_branch_id,
    p_shift_id,
    v_order_no,
    p_order_type,
    p_channel,
    case when p_order_type = 'delivery_manual' then 'pending'::delivery_status else null end,
    p_table_id,
    p_external_order_code,
    p_customer_name,
    p_notes,
    v_subtotal,
    v_discount,
    v_gp,
    p_delivery_pricing_channel,
    p_delivery_app_subtotal,
    p_delivery_commission_rate_pct,
    p_delivery_commission_amount,
    p_delivery_commission_vat_rate_pct,
    p_delivery_commission_vat_amount,
    p_delivery_platform_fee_amount,
    p_delivery_net_payout_amount,
    p_delivery_pricing_source_url,
    p_delivery_pricing_note,
    v_total,
    'queued',
    p_created_by,
    p_request_id
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_input_unit_price := nullif(v_item->>'unit_price', '')::numeric;

    if v_product_id is null then
      raise exception 'INVALID_PRODUCT_ID';
    end if;

    if v_qty is null or v_qty <= 0 then
      raise exception 'INVALID_ITEM_QTY';
    end if;

    if v_input_unit_price is not null and v_input_unit_price < 0 then
      raise exception 'INVALID_ITEM_UNIT_PRICE';
    end if;

    select p.price
    into v_unit_price
    from products p
    where p.id = v_product_id
      and p.tenant_id = p_tenant_id
      and p.branch_id = p_branch_id
      and p.is_active = true;

    if not found then
      raise exception 'PRODUCT_NOT_FOUND:%', v_product_id;
    end if;

    v_unit_price := round(coalesce(v_input_unit_price, v_unit_price), 2);
    v_line_total := round(v_unit_price * v_qty, 2);

    insert into order_items (
      tenant_id,
      branch_id,
      order_id,
      product_id,
      quantity,
      unit_price,
      line_total,
      notes
    )
    values (
      p_tenant_id,
      p_branch_id,
      v_order_id,
      v_product_id,
      v_qty,
      v_unit_price,
      v_line_total,
      nullif(v_item->>'notes', '')
    );
  end loop;

  for rec in
    with recipe_requirements as (
      select
        r.ingredient_id,
        sum(round((oi.quantity * r.quantity_per_item)::numeric, 0))::bigint as required_qty_grams
      from order_items oi
      join recipes r
        on r.product_id = oi.product_id
       and r.tenant_id = p_tenant_id
       and r.branch_id = p_branch_id
      where oi.order_id = v_order_id
        and oi.tenant_id = p_tenant_id
        and oi.branch_id = p_branch_id
        and (
          r.applies_when_takeaway_only = false
          or (r.applies_when_takeaway_only = true and p_order_type in ('takeaway', 'delivery_manual'))
        )
      group by r.ingredient_id
    )
    select ingredient_id, required_qty_grams
    from recipe_requirements
    where required_qty_grams > 0
  loop
    update ingredients i
    set quantity_on_hand = round(i.quantity_on_hand - rec.required_qty_grams, 0)
    where i.id = rec.ingredient_id
      and i.tenant_id = p_tenant_id
      and i.branch_id = p_branch_id
      and (v_allow_negative_stock or i.quantity_on_hand >= rec.required_qty_grams);

    if not found then
      if exists (
        select 1
        from ingredients i
        where i.id = rec.ingredient_id
          and i.tenant_id = p_tenant_id
          and i.branch_id = p_branch_id
      ) then
        raise exception 'INSUFFICIENT_STOCK:%', rec.ingredient_id;
      end if;

      raise exception 'INGREDIENT_NOT_FOUND:%', rec.ingredient_id;
    end if;

    insert into stock_movements (
      tenant_id,
      branch_id,
      ingredient_id,
      movement_type,
      quantity_delta,
      reason,
      ref_table,
      ref_id,
      created_by,
      request_id
    )
    values (
      p_tenant_id,
      p_branch_id,
      rec.ingredient_id,
      'sale_deduction',
      -rec.required_qty_grams,
      'Auto deduction from POS sale',
      'orders',
      v_order_id,
      p_created_by,
      null
    );
  end loop;

  return query
  select v_order_id, v_order_no, 'queued'::text, now(), false;
exception
  when unique_violation then
    if p_request_id is not null then
    select o.id, o.order_no, o.status, o.created_at
    into v_existing_order
    from public.orders o
    where o.tenant_id = p_tenant_id
      and o.branch_id = p_branch_id
      and o.request_id = p_request_id
    limit 1;

      if found then
        return query
        select v_existing_order.id, v_existing_order.order_no, v_existing_order.status::text, v_existing_order.created_at, true;
        return;
      end if;
    end if;
    raise;
end;
$$;
