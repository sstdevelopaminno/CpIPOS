-- Make Table QR recipe-stock deduction atomic with payment completion.
-- Existing POS orders that already have sale_deduction movements keep their current behavior.

create or replace function app.complete_pos_payment_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_received_by uuid,
  p_payment_lines jsonb,
  p_request_group_id text default null
)
returns table(
  payment_group_id text,
  total_paid numeric,
  order_status text,
  duplicate_request boolean
)
language plpgsql
security definer
set search_path to pg_catalog, public, app
set lock_timeout to '5s'
as $$
declare
  v_total_due numeric(12,2);
  v_total_paid numeric(12,2) := 0;
  v_line jsonb;
  v_method public.payment_method;
  v_amount numeric(12,2);
  v_reference text;
  v_order_type text;
  v_channel text;
  v_order_status text;
  v_existing_count integer := 0;
begin
  if p_payment_lines is null
     or jsonb_typeof(p_payment_lines) <> 'array'
     or jsonb_array_length(p_payment_lines) = 0 then
    raise exception 'PAYMENT_LINES_REQUIRED';
  end if;

  select o.total_amount, o.order_type::text, o.channel::text, o.status::text
    into v_total_due, v_order_type, v_channel, v_order_status
  from public.orders o
  where o.id = p_order_id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if p_request_group_id is not null then
    select count(*)
      into v_existing_count
    from public.payments p
    where p.tenant_id = p_tenant_id
      and p.branch_id = p_branch_id
      and p.order_id = p_order_id
      and p.request_group_id = p_request_group_id;

    if v_existing_count > 0 then
      select coalesce(sum(p.amount), 0)::numeric(12,2)
        into v_total_paid
      from public.payments p
      where p.tenant_id = p_tenant_id
        and p.branch_id = p_branch_id
        and p.order_id = p_order_id
        and p.request_group_id = p_request_group_id;

      return query
      select p_request_group_id, v_total_paid, 'completed'::text, true;
      return;
    end if;
  end if;

  if lower(coalesce(v_order_status, '')) in ('completed', 'paid', 'closed', 'cleared') then
    raise exception 'ORDER_ALREADY_PAID';
  end if;
  if lower(coalesce(v_order_status, '')) = 'cancelled' then
    raise exception 'ORDER_CANCELLED_OR_NOT_FOUND';
  end if;

  for v_line in select value from jsonb_array_elements(p_payment_lines)
  loop
    v_method := (v_line->>'method')::public.payment_method;
    v_amount := round(coalesce((v_line->>'amount')::numeric, 0), 2);
    if v_amount <= 0 then
      raise exception 'INVALID_PAYMENT_AMOUNT';
    end if;
    v_total_paid := v_total_paid + v_amount;
  end loop;

  if abs(v_total_paid - v_total_due) > 0.01 then
    raise exception 'PAYMENT_TOTAL_MISMATCH';
  end if;

  if lower(coalesce(v_channel, '')) = 'table_qr'
     and not exists (
       select 1
       from public.stock_movements sm
       where sm.tenant_id = p_tenant_id
         and sm.branch_id = p_branch_id
         and sm.movement_type = 'sale_deduction'
         and sm.ref_table = 'orders'
         and sm.ref_id = p_order_id
     ) then
    perform *
    from public.deduct_order_recipe_stock(
      p_tenant_id,
      p_branch_id,
      p_order_id,
      v_order_type,
      p_received_by,
      'Auto deduction from Table QR payment',
      'table_qr_payment:' || p_order_id::text
    );
  end if;

  for v_line in select value from jsonb_array_elements(p_payment_lines)
  loop
    v_method := (v_line->>'method')::public.payment_method;
    v_amount := round(coalesce((v_line->>'amount')::numeric, 0), 2);
    v_reference := nullif(v_line->>'reference_no', '');

    insert into public.payments (
      tenant_id,
      branch_id,
      order_id,
      method,
      amount,
      reference_no,
      received_by,
      request_group_id
    )
    values (
      p_tenant_id,
      p_branch_id,
      p_order_id,
      v_method,
      v_amount,
      v_reference,
      p_received_by,
      p_request_group_id
    );
  end loop;

  update public.orders o
  set status = 'completed'
  where o.id = p_order_id
    and o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.status <> 'cancelled';

  if not found then
    raise exception 'ORDER_CANCELLED_OR_NOT_FOUND';
  end if;

  return query
  select coalesce(p_request_group_id, ''), v_total_paid, 'completed'::text, false;
end;
$$;

revoke all on function app.complete_pos_payment_tx(uuid,uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function app.complete_pos_payment_tx(uuid,uuid,uuid,uuid,jsonb,text) to service_role;

create or replace function public.complete_pos_payment_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_received_by uuid,
  p_payment_lines jsonb,
  p_request_group_id text default null
)
returns table(
  payment_group_id text,
  total_paid numeric,
  order_status text,
  duplicate_request boolean
)
language sql
security definer
set search_path to pg_catalog, public, app
as $$
  select *
  from app.complete_pos_payment_tx($1, $2, $3, $4, $5, $6);
$$;

revoke all on function public.complete_pos_payment_tx(uuid,uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.complete_pos_payment_tx(uuid,uuid,uuid,uuid,jsonb,text) to service_role;
