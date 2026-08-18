-- FG0003 Table QR toppings: 8 pang-yen products may choose 0-3 free toppings.
-- Reuses existing customer ingredient selection UI backed by recipe rows.
-- Topping recipe rows use quantity_per_item = 0 so existing recipe stock deduction ignores them.

alter table public.products
  add column if not exists customer_ingredient_selection_max integer not null default 0;

comment on column public.products.customer_ingredient_selection_max is
  'Maximum Table QR customer ingredient selections for this product. 0 means no explicit cap beyond available options.';

do $seed$
declare
  v_tenant_id uuid;
  v_branch_id uuid;
  v_product_count integer;
  v_ingredient_count integer;
begin
  select t.id, b.id
    into v_tenant_id, v_branch_id
  from public.tenants t
  join public.branches b on b.tenant_id = t.id
  where t.code = 'FG0003'
    and b.code = 'FG0003-BKK-01';

  if v_tenant_id is null or v_branch_id is null then
    raise exception 'FG0003_SCOPE_NOT_FOUND';
  end if;

  select count(*)
    into v_product_count
  from public.products p
  where p.tenant_id = v_tenant_id
    and p.branch_id = v_branch_id
    and p.name = any(array[
      'ปังเย็น โกโก้',
      'ปังเย็น ชาเขียว',
      'ปังเย็น ชาไทย',
      'ปังเย็น นมชมพู',
      'ปังเย็น นมสด',
      'ปังเย็น เผือกหอม',
      'ปังเย็น โอริโอ้',
      'ปังเย็น โอวัลติน'
    ]::text[]);

  if v_product_count <> 8 then
    raise exception 'FG0003_EXPECTED_8_PRODUCTS_FOUND_%', v_product_count;
  end if;

  select count(*)
    into v_ingredient_count
  from public.ingredients i
  where i.tenant_id = v_tenant_id
    and i.branch_id = v_branch_id
    and i.name = any(array[
      'คอนเฟลค',
      'เยลลี่แดง',
      'โกโก้ครั้น',
      'มาสเมลโล่',
      'ฟุตสลัด',
      'โอริโอ้',
      'โอโจ้แท่ง'
    ]::text[]);

  if v_ingredient_count <> 7 then
    raise exception 'FG0003_EXPECTED_7_TOPPINGS_FOUND_%', v_ingredient_count;
  end if;

  update public.products p
  set customer_ingredient_selection_enabled = true,
      customer_ingredient_selection_max = 3,
      updated_at = now()
  where p.tenant_id = v_tenant_id
    and p.branch_id = v_branch_id
    and p.name = any(array[
      'ปังเย็น โกโก้',
      'ปังเย็น ชาเขียว',
      'ปังเย็น ชาไทย',
      'ปังเย็น นมชมพู',
      'ปังเย็น นมสด',
      'ปังเย็น เผือกหอม',
      'ปังเย็น โอริโอ้',
      'ปังเย็น โอวัลติน'
    ]::text[]);

  insert into public.recipes (
    tenant_id,
    branch_id,
    product_id,
    ingredient_id,
    quantity_per_item,
    applies_when_takeaway_only
  )
  select
    v_tenant_id,
    v_branch_id,
    p.id,
    i.id,
    0,
    false
  from public.products p
  cross join public.ingredients i
  where p.tenant_id = v_tenant_id
    and p.branch_id = v_branch_id
    and i.tenant_id = v_tenant_id
    and i.branch_id = v_branch_id
    and p.name = any(array[
      'ปังเย็น โกโก้',
      'ปังเย็น ชาเขียว',
      'ปังเย็น ชาไทย',
      'ปังเย็น นมชมพู',
      'ปังเย็น นมสด',
      'ปังเย็น เผือกหอม',
      'ปังเย็น โอริโอ้',
      'ปังเย็น โอวัลติน'
    ]::text[])
    and i.name = any(array[
      'คอนเฟลค',
      'เยลลี่แดง',
      'โกโก้ครั้น',
      'มาสเมลโล่',
      'ฟุตสลัด',
      'โอริโอ้',
      'โอโจ้แท่ง'
    ]::text[])
  on conflict (product_id, ingredient_id, applies_when_takeaway_only) do nothing;
end;
$seed$;

create or replace function app.submit_table_qr_order_tx(
  p_qr_session_id uuid,
  p_request_id text,
  p_items jsonb,
  p_note text default null
)
returns table (
  submission_id uuid,
  order_id uuid,
  order_no text,
  table_id uuid,
  table_session_id uuid,
  subtotal numeric,
  tax_total numeric,
  grand_total numeric,
  duplicate_request boolean
)
language plpgsql
security definer
set search_path to 'public', 'app'
as $function$
#variable_conflict use_column
declare
  v_qr table_qr_sessions%rowtype;
  v_session table_bill_sessions%rowtype;
  v_shift_id uuid;
  v_order_id uuid;
  v_order_no text;
  v_submission_id uuid;
  v_new_subtotal numeric(12,2) := 0;
  v_order_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := 0;
  v_tax_total numeric(12,2) := 0;
  v_grand_total numeric(12,2) := 0;
  v_tax_settings record;
  v_tax_line jsonb;
  v_tax_rate numeric(8,4);
  v_tax_amount numeric(12,2);
  v_tax_mode text;
  v_tax_lines jsonb := '[]'::jsonb;
  v_existing record;
  v_item_count integer;
begin
  if nullif(trim(p_request_id), '') is null then
    raise exception 'REQUEST_ID_REQUIRED';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'ITEMS_REQUIRED';
  end if;
  v_item_count := jsonb_array_length(p_items);
  if v_item_count < 1 or v_item_count > 50 then
    raise exception 'INVALID_ITEM_COUNT';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) value
    where value ? 'selected_ingredient_ids'
      and jsonb_typeof(value->'selected_ingredient_ids') <> 'array'
  ) then
    raise exception 'INVALID_CUSTOMER_INGREDIENT_SELECTION';
  end if;

  select *
  into v_qr
  from table_qr_sessions
  where id = p_qr_session_id
  for update;

  if not found then
    raise exception 'QR_SESSION_NOT_FOUND';
  end if;
  if v_qr.status <> 'active' or v_qr.expires_at <= now() then
    if v_qr.status = 'active' and v_qr.expires_at <= now() then
      update table_qr_sessions set status = 'expired' where id = v_qr.id;
    end if;
    raise exception 'QR_SESSION_EXPIRED';
  end if;

  select *
  into v_existing
  from table_qr_orders
  where qr_session_id = v_qr.id
    and request_id = trim(p_request_id)
  limit 1;

  if found then
    select o.order_no, o.subtotal, coalesce(o.tax_total, 0), coalesce(o.grand_total, o.total_amount)
    into v_order_no, v_order_subtotal, v_tax_total, v_grand_total
    from orders o
    where o.id = v_existing.order_id;

    return query
    select
      v_existing.id,
      v_existing.order_id,
      v_order_no,
      v_existing.table_id,
      v_existing.table_session_id,
      v_order_subtotal,
      v_tax_total,
      v_grand_total,
      true;
    return;
  end if;

  select *
  into v_session
  from table_bill_sessions
  where id = v_qr.table_session_id
    and tenant_id = v_qr.tenant_id
    and branch_id = v_qr.branch_id
    and table_id = v_qr.table_id
  for update;

  if not found
     or v_session.status not in ('open', 'ordering', 'pending_payment')
     or v_session.closed_at is not null then
    raise exception 'TABLE_SESSION_CLOSED';
  end if;

  if not exists (
    select 1
    from dining_tables dt
    where dt.id = v_qr.table_id
      and dt.tenant_id = v_qr.tenant_id
      and dt.branch_id = v_qr.branch_id
      and dt.is_active = true
      and dt.status in ('occupied', 'ordering', 'pending_payment')
  ) then
    raise exception 'TABLE_NOT_AVAILABLE';
  end if;

  select s.id
  into v_shift_id
  from shifts s
  where s.tenant_id = v_qr.tenant_id
    and s.branch_id = v_qr.branch_id
    and s.status = 'open'
  order by s.opened_at desc
  limit 1;

  if v_shift_id is null then
    raise exception 'SHIFT_NOT_OPEN';
  end if;

  v_order_id := v_session.order_id;
  if v_order_id is not null then
    select o.order_no, coalesce(o.discount_amount, 0)
    into v_order_no, v_discount
    from orders o
    where o.id = v_order_id
      and o.tenant_id = v_qr.tenant_id
      and o.branch_id = v_qr.branch_id
      and o.table_id = v_qr.table_id
      and o.status = 'queued'
    for update;
    if not found then
      raise exception 'ORDER_NOT_UPDATABLE';
    end if;
  else
    v_order_id := gen_random_uuid();
    v_order_no := format(
      'DIN-QR-%s-%s',
      to_char(now(), 'YYYYMMDDHH24MISS'),
      upper(substr(replace(v_order_id::text, '-', ''), 1, 6))
    );
    insert into orders (
      id, tenant_id, branch_id, shift_id, order_no, order_type, channel,
      table_id, subtotal, discount_amount, gp_amount, total_amount,
      tax_total, grand_total, metadata, status, created_by
    )
    values (
      v_order_id, v_qr.tenant_id, v_qr.branch_id, v_shift_id, v_order_no,
      'dine_in', 'table_qr', v_qr.table_id, 0, 0, 0, 0, 0, 0,
      jsonb_build_object('tax_lines', '[]'::jsonb, 'source', 'table_qr'),
      'queued', v_session.opened_by
    );
  end if;

  if exists (
    with raw_items as (
      select
        nullif(value->>'product_id', '')::uuid as product_id,
        case
          when value ? 'selected_ingredient_ids' then coalesce((
            select jsonb_agg(x.ingredient_id order by x.ingredient_id)
            from (
              select distinct trim(selected_id) as ingredient_id
              from jsonb_array_elements_text(value->'selected_ingredient_ids') selected_id
              where nullif(trim(selected_id), '') is not null
            ) x
          ), '[]'::jsonb)
          else '[]'::jsonb
        end as selected_ingredient_ids
      from jsonb_array_elements(p_items) value
    )
    select 1
    from raw_items ri
    cross join lateral jsonb_array_elements_text(ri.selected_ingredient_ids) selected_id
    where selected_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'INVALID_CUSTOMER_INGREDIENT_SELECTION';
  end if;

  if exists (
    with raw_items as (
      select
        nullif(value->>'product_id', '')::uuid as product_id,
        case
          when value ? 'selected_ingredient_ids' then coalesce((
            select jsonb_agg(x.ingredient_id order by x.ingredient_id)
            from (
              select distinct trim(selected_id) as ingredient_id
              from jsonb_array_elements_text(value->'selected_ingredient_ids') selected_id
              where nullif(trim(selected_id), '') is not null
            ) x
          ), '[]'::jsonb)
          else '[]'::jsonb
        end as selected_ingredient_ids
      from jsonb_array_elements(p_items) value
    )
    select 1
    from raw_items ri
    join products p on p.id = ri.product_id
      and p.tenant_id = v_qr.tenant_id
      and p.branch_id = v_qr.branch_id
    where jsonb_array_length(ri.selected_ingredient_ids) > 0
      and coalesce(p.customer_ingredient_selection_enabled, false) = false
  ) then
    raise exception 'CUSTOMER_INGREDIENT_SELECTION_NOT_ALLOWED';
  end if;

  if exists (
    with raw_items as (
      select
        nullif(value->>'product_id', '')::uuid as product_id,
        case
          when value ? 'selected_ingredient_ids' then coalesce((
            select jsonb_agg(x.ingredient_id order by x.ingredient_id)
            from (
              select distinct trim(selected_id) as ingredient_id
              from jsonb_array_elements_text(value->'selected_ingredient_ids') selected_id
              where nullif(trim(selected_id), '') is not null
            ) x
          ), '[]'::jsonb)
          else '[]'::jsonb
        end as selected_ingredient_ids
      from jsonb_array_elements(p_items) value
    )
    select 1
    from raw_items ri
    join products p on p.id = ri.product_id
      and p.tenant_id = v_qr.tenant_id
      and p.branch_id = v_qr.branch_id
    where coalesce(p.customer_ingredient_selection_max, 0) > 0
      and jsonb_array_length(ri.selected_ingredient_ids) > p.customer_ingredient_selection_max
  ) then
    raise exception 'TOO_MANY_CUSTOMER_INGREDIENTS';
  end if;

  if exists (
    with raw_items as (
      select
        nullif(value->>'product_id', '')::uuid as product_id,
        case
          when value ? 'selected_ingredient_ids' then coalesce((
            select jsonb_agg(x.ingredient_id order by x.ingredient_id)
            from (
              select distinct trim(selected_id) as ingredient_id
              from jsonb_array_elements_text(value->'selected_ingredient_ids') selected_id
              where nullif(trim(selected_id), '') is not null
            ) x
          ), '[]'::jsonb)
          else '[]'::jsonb
        end as selected_ingredient_ids
      from jsonb_array_elements(p_items) value
    )
    select 1
    from raw_items ri
    cross join lateral jsonb_array_elements_text(ri.selected_ingredient_ids) selected_id
    where not exists (
      select 1
      from recipes r
      join ingredients i on i.id = r.ingredient_id
        and i.tenant_id = v_qr.tenant_id
        and i.branch_id = v_qr.branch_id
      where r.tenant_id = v_qr.tenant_id
        and r.branch_id = v_qr.branch_id
        and r.product_id = ri.product_id
        and r.ingredient_id::text = selected_id
        and coalesce(r.applies_when_takeaway_only, false) = false
        and i.name not like 'STOCK:%'
    )
  ) then
    raise exception 'INVALID_CUSTOMER_INGREDIENT_SELECTION';
  end if;

  with raw_items as (
    select
      nullif(value->>'product_id', '')::uuid as product_id,
      nullif(value->>'quantity', '')::numeric as quantity,
      nullif(left(trim(coalesce(value->>'note', '')), 240), '') as raw_notes,
      case
        when value ? 'selected_ingredient_ids' then coalesce((
          select jsonb_agg(x.ingredient_id order by x.ingredient_id)
          from (
            select distinct trim(selected_id) as ingredient_id
            from jsonb_array_elements_text(value->'selected_ingredient_ids') selected_id
            where nullif(trim(selected_id), '') is not null
          ) x
        ), '[]'::jsonb)
        else '[]'::jsonb
      end as selected_ingredient_ids
    from jsonb_array_elements(p_items) value
  ), normalized_items as (
    select
      product_id,
      sum(quantity) as quantity,
      case when jsonb_array_length(selected_ingredient_ids) > 0 then null else raw_notes end as notes,
      selected_ingredient_ids
    from raw_items
    group by product_id,
      case when jsonb_array_length(selected_ingredient_ids) > 0 then null else raw_notes end,
      selected_ingredient_ids
  )
  select coalesce(sum(quantity), 0)
  into v_item_count
  from normalized_items
  where product_id is not null
    and quantity > 0
    and quantity <= 99;

  if v_item_count < 1 then
    raise exception 'ITEMS_REQUIRED';
  end if;

  if exists (
    with normalized_items as (
      select nullif(value->>'product_id', '')::uuid as product_id
      from jsonb_array_elements(p_items) value
    )
    select 1
    from normalized_items ni
    left join products p on p.id = ni.product_id
      and p.tenant_id = v_qr.tenant_id
      and p.branch_id = v_qr.branch_id
      and p.is_active = true
    where ni.product_id is null or p.id is null
  ) then
    raise exception 'PRODUCT_NOT_AVAILABLE';
  end if;

  with raw_items as (
    select
      nullif(value->>'product_id', '')::uuid as product_id,
      nullif(value->>'quantity', '')::numeric as quantity,
      nullif(left(trim(coalesce(value->>'note', '')), 240), '') as raw_notes,
      case
        when value ? 'selected_ingredient_ids' then coalesce((
          select jsonb_agg(x.ingredient_id order by x.ingredient_id)
          from (
            select distinct trim(selected_id) as ingredient_id
            from jsonb_array_elements_text(value->'selected_ingredient_ids') selected_id
            where nullif(trim(selected_id), '') is not null
          ) x
        ), '[]'::jsonb)
        else '[]'::jsonb
      end as selected_ingredient_ids
    from jsonb_array_elements(p_items) value
  ), normalized_items as (
    select
      product_id,
      sum(quantity) as quantity,
      case when jsonb_array_length(selected_ingredient_ids) > 0 then null else raw_notes end as notes,
      selected_ingredient_ids
    from raw_items
    group by product_id,
      case when jsonb_array_length(selected_ingredient_ids) > 0 then null else raw_notes end,
      selected_ingredient_ids
  ), product_rows as (
    select
      p.id,
      p.price,
      ni.quantity,
      ni.selected_ingredient_ids,
      case
        when jsonb_array_length(ni.selected_ingredient_ids) > 0 then
          left('ลูกค้าเลือก: ' || coalesce((
            select string_agg(i.name, ', ' order by i.name)
            from recipes r
            join ingredients i on i.id = r.ingredient_id
              and i.tenant_id = v_qr.tenant_id
              and i.branch_id = v_qr.branch_id
            where r.tenant_id = v_qr.tenant_id
              and r.branch_id = v_qr.branch_id
              and r.product_id = p.id
              and r.ingredient_id::text in (
                select jsonb_array_elements_text(ni.selected_ingredient_ids)
              )
              and coalesce(r.applies_when_takeaway_only, false) = false
              and i.name not like 'STOCK:%'
          ), ''), 240)
        else ni.notes
      end as notes,
      coalesce((
        select jsonb_agg(
          jsonb_build_object('ingredient_id', i.id, 'name', i.name)
          order by i.name
        )
        from recipes r
        join ingredients i on i.id = r.ingredient_id
          and i.tenant_id = v_qr.tenant_id
          and i.branch_id = v_qr.branch_id
        where r.tenant_id = v_qr.tenant_id
          and r.branch_id = v_qr.branch_id
          and r.product_id = p.id
          and r.ingredient_id::text in (
            select jsonb_array_elements_text(ni.selected_ingredient_ids)
          )
          and coalesce(r.applies_when_takeaway_only, false) = false
          and i.name not like 'STOCK:%'
      ), '[]'::jsonb) as selected_ingredients
    from normalized_items ni
    join products p on p.id = ni.product_id
      and p.tenant_id = v_qr.tenant_id
      and p.branch_id = v_qr.branch_id
      and p.is_active = true
    where ni.quantity > 0 and ni.quantity <= 99
  ), inserted_items as (
    insert into order_items (
      tenant_id, branch_id, order_id, product_id, quantity,
      unit_price, line_total, notes, metadata
    )
    select
      v_qr.tenant_id,
      v_qr.branch_id,
      v_order_id,
      pr.id,
      pr.quantity,
      pr.price,
      round(pr.price * pr.quantity, 2),
      pr.notes,
      case
        when jsonb_array_length(pr.selected_ingredient_ids) > 0 then
          jsonb_build_object(
            'table_qr', jsonb_build_object(
              'selected_ingredient_ids', pr.selected_ingredient_ids,
              'selected_ingredients', pr.selected_ingredients
            )
          )
        else '{}'::jsonb
      end
    from product_rows pr
    returning quantity, line_total
  )
  select round(coalesce(sum(line_total), 0), 2), coalesce(sum(quantity), 0)
  into v_new_subtotal, v_item_count
  from inserted_items;

  select round(coalesce(sum(oi.line_total), 0), 2)
  into v_order_subtotal
  from order_items oi
  where oi.tenant_id = v_qr.tenant_id
    and oi.branch_id = v_qr.branch_id
    and oi.order_id = v_order_id;

  select t.is_enabled, t.settings
  into v_tax_settings
  from tenant_tax_settings t
  where t.tenant_id = v_qr.tenant_id
    and t.branch_id = v_qr.branch_id
  limit 1;

  if found and v_tax_settings.is_enabled = true then
    for v_tax_line in
      select value
      from jsonb_array_elements(coalesce(v_tax_settings.settings->'lines', '[]'::jsonb))
    loop
      if coalesce((v_tax_line->>'is_active')::boolean, true) = true then
        v_tax_rate := greatest(coalesce(nullif(v_tax_line->>'rate_pct', '')::numeric, 0), 0);
        if v_tax_rate > 0 then
          v_tax_mode := coalesce(v_tax_line->>'mode', 'add_to_bill');
          v_tax_amount := round(greatest(v_order_subtotal - v_discount, 0) * (v_tax_rate / 100), 2);
          if v_tax_mode = 'deduct_from_bill' then
            v_tax_amount := -v_tax_amount;
          end if;
          v_tax_total := v_tax_total + v_tax_amount;
          v_tax_lines := v_tax_lines || jsonb_build_array(jsonb_build_object(
            'id', coalesce(v_tax_line->>'id', gen_random_uuid()::text),
            'label', coalesce(v_tax_line->>'label', 'Tax'),
            'rate_pct', v_tax_rate,
            'mode', v_tax_mode,
            'amount', v_tax_amount
          ));
        end if;
      end if;
    end loop;
  end if;

  v_tax_total := round(v_tax_total, 2);
  v_grand_total := round(greatest(v_order_subtotal - v_discount + v_tax_total, 0), 2);

  update orders
  set shift_id = v_shift_id,
      subtotal = v_order_subtotal,
      total_amount = v_grand_total,
      tax_total = v_tax_total,
      grand_total = v_grand_total,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'tax_lines', v_tax_lines,
        'last_table_qr_order_at', now()
      )
  where id = v_order_id
    and tenant_id = v_qr.tenant_id
    and branch_id = v_qr.branch_id;

  update table_bill_sessions
  set order_id = v_order_id,
      status = 'ordering',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'last_order_id', v_order_id,
        'last_order_no', v_order_no,
        'last_table_qr_order_at', now()
      )
  where id = v_session.id;

  update dining_tables
  set status = 'ordering'
  where id = v_qr.table_id
    and tenant_id = v_qr.tenant_id
    and branch_id = v_qr.branch_id;

  v_submission_id := gen_random_uuid();
  insert into table_qr_orders (
    id, tenant_id, branch_id, table_id, table_session_id, qr_session_id,
    order_id, request_id, item_count, subtotal, payload
  )
  values (
    v_submission_id,
    v_qr.tenant_id,
    v_qr.branch_id,
    v_qr.table_id,
    v_session.id,
    v_qr.id,
    v_order_id,
    trim(p_request_id),
    v_item_count,
    v_new_subtotal,
    jsonb_build_object('items', p_items, 'note', nullif(trim(coalesce(p_note, '')), ''))
  );

  return query
  select
    v_submission_id,
    v_order_id,
    v_order_no,
    v_qr.table_id,
    v_session.id,
    v_order_subtotal,
    v_tax_total,
    v_grand_total,
    false;
end;
$function$;
