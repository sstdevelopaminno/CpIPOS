# Proposed Mobile Takeaway RPC

Status: proposal only, not applied.

Apply this to the shared SSTiPOS Supabase database after review. Each RPC call runs in one PostgreSQL transaction, so line replacement, order totals, payment insertion, and final status updates succeed or roll back together.

```sql
create or replace function public.mobile_takeaway_hold_bill(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_session_id uuid,
  p_user_id uuid,
  p_order_id uuid,
  p_discount_mode text default 'amount',
  p_discount_value numeric default 0,
  p_items jsonb default '[]'::jsonb
)
returns table(order_id uuid, order_no text, total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_line record;
  v_product record;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total numeric := 0;
  v_now timestamptz := now();
begin
  select o.id, o.order_no
    into v_order
  from public.orders o
  where o.id = p_order_id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.pos_session_id = p_session_id
    and o.order_type = 'takeaway'
    and o.status = 'draft'
  for update;

  if not found then
    raise exception 'draft_order_not_found';
  end if;

  create temporary table tmp_mobile_takeaway_lines(
    product_id uuid not null,
    name text,
    quantity integer not null,
    unit_price numeric not null,
    line_total numeric not null
  ) on commit drop;

  for v_line in
    select (item->>'product_id')::uuid as product_id, greatest((item->>'quantity')::integer, 1) as quantity
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item
  loop
    select id, name, price
      into v_product
    from public.products
    where id = v_line.product_id
      and tenant_id = p_tenant_id
      and branch_id = p_branch_id
      and is_active = true;

    if not found then
      raise exception 'product_not_available';
    end if;

    insert into tmp_mobile_takeaway_lines(product_id, name, quantity, unit_price, line_total)
    values (v_product.id, v_product.name, v_line.quantity, coalesce(v_product.price, 0), v_line.quantity * coalesce(v_product.price, 0));
  end loop;

  select coalesce(sum(line_total), 0) into v_subtotal from tmp_mobile_takeaway_lines;
  v_discount := case
    when p_discount_mode = 'percent' then least(v_subtotal, v_subtotal * least(greatest(coalesce(p_discount_value, 0), 0), 100) / 100)
    else least(v_subtotal, greatest(coalesce(p_discount_value, 0), 0))
  end;
  v_total := greatest(0, v_subtotal - v_discount);

  delete from public.order_items oi
  where oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = v_order.id;

  insert into public.order_items(tenant_id, branch_id, order_id, product_id, name, quantity, unit_price, line_total, metadata)
  select p_tenant_id, p_branch_id, v_order.id, product_id, name, quantity, unit_price, line_total, jsonb_build_object('source_app', 'mobile_web', 'mode', 'takeaway_hold')
  from tmp_mobile_takeaway_lines;

  update public.orders o
  set subtotal = v_subtotal,
      discount_amount = v_discount,
      total_amount = v_total,
      grand_total = v_total,
      status = 'draft',
      updated_at = v_now,
      metadata = jsonb_build_object(
        'source_app', 'mobile_web',
        'mode', 'takeaway',
        'hold_state', 'held',
        'held_from', 'mobile_takeaway',
        'held_by', p_user_id,
        'held_at', v_now,
        'discount_mode', coalesce(p_discount_mode, 'amount'),
        'discount_value', coalesce(p_discount_value, 0)
      )
  where o.id = v_order.id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.status = 'draft';

  return query select v_order.id::uuid, v_order.order_no::text, v_total::numeric;
end;
$$;

create or replace function public.mobile_takeaway_checkout_bill(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_session_id uuid,
  p_user_id uuid,
  p_device_code text,
  p_order_id uuid,
  p_payment_method text,
  p_cash_received numeric default null,
  p_reference_no text default null,
  p_discount_mode text default 'amount',
  p_discount_value numeric default 0,
  p_items jsonb default '[]'::jsonb
)
returns table(order_id uuid, order_no text, total numeric, payment_method text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift_id uuid;
  v_order record;
  v_line record;
  v_product record;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_total numeric := 0;
  v_now timestamptz := now();
  v_request_id uuid := gen_random_uuid();
  v_db_payment_method text := case when p_payment_method = 'transfer' then 'bank_transfer' else 'cash' end;
begin
  select id into v_shift_id
  from public.shifts
  where tenant_id = p_tenant_id
    and branch_id = p_branch_id
    and device_code = p_device_code
    and status = 'open'
  for update;

  if v_shift_id is null then
    raise exception 'shift_not_open';
  end if;

  select o.id, o.order_no
    into v_order
  from public.orders o
  where o.id = p_order_id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.shift_id = v_shift_id
    and o.pos_session_id = p_session_id
    and o.device_code = p_device_code
    and o.order_type = 'takeaway'
    and o.status = 'draft'
  for update;

  if not found then
    raise exception 'draft_order_not_found';
  end if;

  create temporary table tmp_mobile_takeaway_lines(
    product_id uuid not null,
    name text,
    quantity integer not null,
    unit_price numeric not null,
    line_total numeric not null
  ) on commit drop;

  for v_line in
    select (item->>'product_id')::uuid as product_id, greatest((item->>'quantity')::integer, 1) as quantity
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item
  loop
    select id, name, price
      into v_product
    from public.products
    where id = v_line.product_id
      and tenant_id = p_tenant_id
      and branch_id = p_branch_id
      and is_active = true;

    if not found then
      raise exception 'product_not_available';
    end if;

    insert into tmp_mobile_takeaway_lines(product_id, name, quantity, unit_price, line_total)
    values (v_product.id, v_product.name, v_line.quantity, coalesce(v_product.price, 0), v_line.quantity * coalesce(v_product.price, 0));
  end loop;

  if not exists (select 1 from tmp_mobile_takeaway_lines) then
    raise exception 'empty_cart';
  end if;

  select coalesce(sum(line_total), 0) into v_subtotal from tmp_mobile_takeaway_lines;
  v_discount := case
    when p_discount_mode = 'percent' then least(v_subtotal, v_subtotal * least(greatest(coalesce(p_discount_value, 0), 0), 100) / 100)
    else least(v_subtotal, greatest(coalesce(p_discount_value, 0), 0))
  end;
  v_total := greatest(0, v_subtotal - v_discount);

  if p_payment_method = 'cash' and coalesce(p_cash_received, 0) < v_total then
    raise exception 'cash_not_enough';
  end if;

  delete from public.order_items oi
  where oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = v_order.id;

  insert into public.order_items(tenant_id, branch_id, order_id, product_id, name, quantity, unit_price, line_total, metadata)
  select p_tenant_id, p_branch_id, v_order.id, product_id, name, quantity, unit_price, line_total, jsonb_build_object('source_app', 'mobile_web')
  from tmp_mobile_takeaway_lines;

  perform 1
  from public.deduct_order_recipe_stock(
    p_tenant_id,
    p_branch_id,
    v_order.id,
    'takeaway',
    p_user_id,
    'Auto deduction from Mobile takeaway checkout',
    v_request_id::text
  );

  update public.orders o
  set subtotal = v_subtotal,
      discount_amount = v_discount,
      total_amount = v_total,
      grand_total = v_total,
      tax_total = 0,
      paid_total = 0,
      cashier_user_id = p_user_id,
      cash_received = case when p_payment_method = 'cash' then coalesce(p_cash_received, 0) else null end,
      change_amount = case when p_payment_method = 'cash' then coalesce(p_cash_received, 0) - v_total else 0 end,
      request_id = v_request_id,
      updated_at = v_now,
      metadata = jsonb_build_object(
        'source_app', 'mobile_web',
        'mode', 'takeaway',
        'payment_method', v_db_payment_method,
        'discount_mode', coalesce(p_discount_mode, 'amount'),
        'discount_value', coalesce(p_discount_value, 0)
      )
  where o.id = v_order.id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.status = 'draft';

  insert into public.payments(
    tenant_id, branch_id, order_id, method, amount, reference_no, received_by,
    received_at, request_group_id, shift_id, pos_session_id, status, metadata
  )
  values (
    p_tenant_id, p_branch_id, v_order.id, v_db_payment_method, v_total,
    case when p_payment_method = 'transfer' then p_reference_no else null end,
    p_user_id, v_now, v_request_id, v_shift_id, p_session_id, 'paid',
    jsonb_build_object('source_app', 'mobile_web', 'cash_received', case when p_payment_method = 'cash' then coalesce(p_cash_received, 0) else null end)
  );

  update public.orders o
  set status = 'completed',
      paid_total = v_total,
      payment_completed_at = v_now,
      payment_completed_by = p_user_id,
      updated_at = v_now
  where o.id = v_order.id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.status = 'draft';

  return query select v_order.id::uuid, v_order.order_no::text, v_total::numeric, p_payment_method::text;
end;
$$;
```
