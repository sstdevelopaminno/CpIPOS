-- Source-only forward migration for table order concurrency and dine-in bill sync hardening.
-- Do not apply automatically from this task.

create or replace function app.submit_table_qr_order_tx(
  p_qr_session_id uuid,
  p_request_id text,
  p_items jsonb,
  p_note text default null
)
returns table(
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
set search_path = public, app
as $$
declare
  v_qr table_qr_sessions%rowtype;
  v_session table_bill_sessions%rowtype;
  v_shift_id uuid;
  v_order_id uuid;
  v_order_no text;
  v_submission_id uuid;
  v_item jsonb;
  v_product record;
  v_quantity numeric(12,3);
  v_line_total numeric(12,2);
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

  with normalized_items as (
    select
      nullif(value->>'product_id', '')::uuid as product_id,
      sum(nullif(value->>'quantity', '')::numeric) as quantity,
      nullif(left(trim(coalesce(value->>'note', '')), 240), '') as notes
    from jsonb_array_elements(p_items) value
    group by 1, 3
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

  with normalized_items as (
    select
      nullif(value->>'product_id', '')::uuid as product_id,
      sum(nullif(value->>'quantity', '')::numeric) as quantity,
      nullif(left(trim(coalesce(value->>'note', '')), 240), '') as notes
    from jsonb_array_elements(p_items) value
    group by 1, 3
  ), product_rows as (
    select p.id, p.price, ni.quantity, ni.notes
    from normalized_items ni
    join products p on p.id = ni.product_id
      and p.tenant_id = v_qr.tenant_id
      and p.branch_id = v_qr.branch_id
      and p.is_active = true
    where ni.quantity > 0 and ni.quantity <= 99
  ), inserted_items as (
    insert into order_items (
      tenant_id, branch_id, order_id, product_id, quantity,
      unit_price, line_total, notes
    )
    select
      v_qr.tenant_id, v_qr.branch_id, v_order_id, pr.id, pr.quantity,
      pr.price, round(pr.price * pr.quantity, 2), pr.notes
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
    v_submission_id, v_qr.tenant_id, v_qr.branch_id, v_qr.table_id,
    v_session.id, v_qr.id, v_order_id, trim(p_request_id), v_item_count,
    v_new_subtotal, jsonb_build_object('items', p_items, 'note', nullif(trim(coalesce(p_note, '')), ''))
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
$$;

revoke all on function app.submit_table_qr_order_tx(uuid, text, jsonb, text) from public;
grant execute on function app.submit_table_qr_order_tx(uuid, text, jsonb, text) to service_role;


create unique index if not exists ux_orders_one_queued_dine_in_table
  on public.orders (tenant_id, branch_id, table_id)
  where order_type = 'dine_in'
    and status = 'queued'
    and table_id is not null;

create or replace function app.bind_dine_in_order_to_table_session()
returns trigger
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_session public.table_bill_sessions%rowtype;
begin
  if new.order_type <> 'dine_in' or new.table_id is null or new.status <> 'queued' then
    return new;
  end if;

  select *
  into v_session
  from public.table_bill_sessions s
  where s.tenant_id = new.tenant_id
    and s.branch_id = new.branch_id
    and s.table_id = new.table_id
    and s.status in ('open', 'ordering')
    and s.closed_at is null
  order by s.opened_at desc
  limit 1
  for update;

  if not found then
    raise exception 'TABLE_BILL_NOT_OPEN';
  end if;
  if v_session.order_id is not null and v_session.order_id <> new.id then
    raise exception 'TABLE_BILL_ORDER_CONFLICT';
  end if;

  update public.table_bill_sessions s
  set order_id = coalesce(s.order_id, new.id),
      status = 'ordering',
      metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object('last_order_id', new.id, 'last_order_no', new.order_no),
      updated_at = now()
  where s.id = v_session.id
    and s.tenant_id = new.tenant_id
    and s.branch_id = new.branch_id
    and (s.order_id is null or s.order_id = new.id);

  update public.dining_tables t
  set status = 'ordering', updated_at = now()
  where t.id = new.table_id
    and t.tenant_id = new.tenant_id
    and t.branch_id = new.branch_id;

  return new;
end;
$$;

drop trigger if exists trg_bind_dine_in_order_to_table_session on public.orders;
create trigger trg_bind_dine_in_order_to_table_session
after insert on public.orders
for each row execute function app.bind_dine_in_order_to_table_session();

revoke all on function app.bind_dine_in_order_to_table_session() from public;
grant execute on function app.bind_dine_in_order_to_table_session() to service_role;

create or replace function app.replace_queued_dine_in_order_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_shift_id uuid,
  p_actor_user_id uuid,
  p_order_id uuid,
  p_table_id uuid,
  p_items jsonb,
  p_app_total_amount numeric,
  p_discount_amount numeric default 0,
  p_gp_amount numeric default 0,
  p_tax_total numeric default 0,
  p_grand_total numeric default null,
  p_tax_lines jsonb default '[]'::jsonb
)
returns table(order_id uuid, order_no text, order_status text, created_at timestamptz, total_amount numeric)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_session public.table_bill_sessions%rowtype;
  v_order public.orders%rowtype;
  v_subtotal numeric(12,2) := round(coalesce(p_app_total_amount, 0), 2);
  v_total numeric(12,2) := round(coalesce(p_grand_total, p_app_total_amount - coalesce(p_discount_amount,0) - coalesce(p_gp_amount,0) + coalesce(p_tax_total,0)), 2);
  v_item_count numeric := 0;
begin
  select * into v_session
  from public.table_bill_sessions s
  where s.tenant_id = p_tenant_id
    and s.branch_id = p_branch_id
    and s.table_id = p_table_id
    and s.status in ('open', 'ordering')
    and s.closed_at is null
  order by s.opened_at desc
  limit 1
  for update;
  if not found then raise exception 'TABLE_BILL_NOT_OPEN'; end if;
  if v_session.order_id is not null and v_session.order_id <> p_order_id then raise exception 'TABLE_BILL_ORDER_CONFLICT'; end if;

  select * into v_order
  from public.orders o
  where o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.id = p_order_id
    and o.table_id = p_table_id
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status <> 'queued' then raise exception 'ORDER_NOT_QUEUED'; end if;
  if v_order.order_type <> 'dine_in' then raise exception 'ORDER_NOT_DINE_IN'; end if;
  if not exists (select 1 from public.shifts sh where sh.id = p_shift_id and sh.tenant_id = p_tenant_id and sh.branch_id = p_branch_id and sh.status = 'open') then
    raise exception 'SHIFT_NOT_OPEN';
  end if;

  with normalized_items as (
    select
      nullif(value->>'product_id', '')::uuid as product_id,
      sum(nullif(value->>'quantity', '')::numeric) as quantity,
      max(nullif(value->>'unit_price', '')::numeric) as unit_price,
      nullif(left(trim(coalesce(value->>'notes', value->>'note', '')), 240), '') as notes
    from jsonb_array_elements(p_items) value
    group by 1, 4
  )
  select coalesce(sum(quantity), 0) into v_item_count
  from normalized_items
  where product_id is not null and quantity > 0 and quantity <= 999;
  if v_item_count < 1 then raise exception 'ITEMS_REQUIRED'; end if;

  delete from public.order_items oi
  where oi.tenant_id = p_tenant_id
    and oi.branch_id = p_branch_id
    and oi.order_id = p_order_id;

  with normalized_items as (
    select
      nullif(value->>'product_id', '')::uuid as product_id,
      sum(nullif(value->>'quantity', '')::numeric) as quantity,
      max(nullif(value->>'unit_price', '')::numeric) as unit_price,
      nullif(left(trim(coalesce(value->>'notes', value->>'note', '')), 240), '') as notes
    from jsonb_array_elements(p_items) value
    group by 1, 4
  ), product_rows as (
    select p.id, coalesce(ni.unit_price, p.price) as unit_price, ni.quantity, ni.notes
    from normalized_items ni
    join public.products p on p.id = ni.product_id
      and p.tenant_id = p_tenant_id
      and p.branch_id = p_branch_id
      and p.is_active = true
    where ni.quantity > 0 and ni.quantity <= 999
  )
  insert into public.order_items(tenant_id, branch_id, order_id, product_id, quantity, unit_price, line_total, notes)
  select p_tenant_id, p_branch_id, p_order_id, pr.id, pr.quantity, pr.unit_price, round(pr.quantity * pr.unit_price, 2), pr.notes
  from product_rows pr;

  update public.orders o
  set shift_id = p_shift_id,
      subtotal = v_subtotal,
      discount_amount = coalesce(p_discount_amount, 0),
      gp_amount = coalesce(p_gp_amount, 0),
      total_amount = v_total,
      tax_total = coalesce(p_tax_total, 0),
      grand_total = v_total,
      metadata = coalesce(o.metadata, '{}'::jsonb) || jsonb_build_object('tax_lines', coalesce(p_tax_lines, '[]'::jsonb), 'updated_from', 'pos_dine_in_rpc'),
      updated_at = now()
  where o.id = p_order_id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.status = 'queued'
  returning * into v_order;

  update public.table_bill_sessions s
  set order_id = p_order_id,
      status = 'ordering',
      metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object('last_order_id', p_order_id, 'last_order_no', v_order.order_no),
      updated_at = now()
  where s.id = v_session.id;

  return query select v_order.id, v_order.order_no, v_order.status::text, v_order.created_at, v_order.total_amount;
end;
$$;

revoke all on function app.replace_queued_dine_in_order_tx(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, numeric, numeric, numeric, numeric, numeric, jsonb) from public;
grant execute on function app.replace_queued_dine_in_order_tx(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, numeric, numeric, numeric, numeric, numeric, jsonb) to service_role;

create or replace function app.cancel_empty_table_bill_session_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_table_id uuid,
  p_actor_user_id uuid
)
returns table(table_session_id uuid, table_id uuid, cancelled boolean)
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_session public.table_bill_sessions%rowtype;
begin
  select * into v_session
  from public.table_bill_sessions s
  where s.tenant_id = p_tenant_id
    and s.branch_id = p_branch_id
    and s.table_id = p_table_id
    and s.status in ('open', 'ordering')
    and s.closed_at is null
  order by s.opened_at desc
  limit 1
  for update;
  if not found then raise exception 'TABLE_BILL_NOT_OPEN'; end if;
  if v_session.order_id is not null then raise exception 'TABLE_BILL_NOT_EMPTY'; end if;
  if exists (
    select 1 from public.orders o
    where o.tenant_id = p_tenant_id
      and o.branch_id = p_branch_id
      and o.table_id = p_table_id
      and o.status not in ('cancelled', 'completed', 'paid', 'closed')
  ) then
    raise exception 'TABLE_BILL_NOT_EMPTY';
  end if;

  update public.table_bill_sessions s
  set status = 'cancelled',
      closed_at = now(),
      closed_by = p_actor_user_id,
      metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object('cancelled_empty_bill', true),
      updated_at = now()
  where s.id = v_session.id;

  update public.dining_tables t
  set status = 'available', updated_at = now()
  where t.id = p_table_id
    and t.tenant_id = p_tenant_id
    and t.branch_id = p_branch_id;

  return query select v_session.id, p_table_id, true;
end;
$$;

revoke all on function app.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) from public;
grant execute on function app.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) to service_role;


create or replace function public.replace_queued_dine_in_order_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_shift_id uuid,
  p_actor_user_id uuid,
  p_order_id uuid,
  p_table_id uuid,
  p_items jsonb,
  p_app_total_amount numeric,
  p_discount_amount numeric default 0,
  p_gp_amount numeric default 0,
  p_tax_total numeric default 0,
  p_grand_total numeric default null,
  p_tax_lines jsonb default '[]'::jsonb
)
returns table(order_id uuid, order_no text, order_status text, created_at timestamptz, total_amount numeric)
language sql
security definer
set search_path = public, app
as $$
  select * from app.replace_queued_dine_in_order_tx(
    p_tenant_id, p_branch_id, p_shift_id, p_actor_user_id, p_order_id, p_table_id,
    p_items, p_app_total_amount, p_discount_amount, p_gp_amount, p_tax_total, p_grand_total, p_tax_lines
  );
$$;

revoke all on function public.replace_queued_dine_in_order_tx(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, numeric, numeric, numeric, numeric, numeric, jsonb) from public;
revoke all on function public.replace_queued_dine_in_order_tx(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, numeric, numeric, numeric, numeric, numeric, jsonb) from anon;
revoke all on function public.replace_queued_dine_in_order_tx(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, numeric, numeric, numeric, numeric, numeric, jsonb) from authenticated;
grant execute on function public.replace_queued_dine_in_order_tx(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, numeric, numeric, numeric, numeric, numeric, jsonb) to service_role;

create or replace function public.cancel_empty_table_bill_session_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_table_id uuid,
  p_actor_user_id uuid
)
returns table(table_session_id uuid, table_id uuid, cancelled boolean)
language sql
security definer
set search_path = public, app
as $$
  select * from app.cancel_empty_table_bill_session_tx(p_tenant_id, p_branch_id, p_table_id, p_actor_user_id);
$$;

revoke all on function public.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) from public;
revoke all on function public.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) from anon;
revoke all on function public.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) to service_role;
