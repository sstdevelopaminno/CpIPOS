-- Close the Table QR vs checkout race and make payment-lock state changes atomic.
-- Same-table operations serialize on the bill-session row; unrelated tables/tenants remain independent.

create or replace function app.guard_table_bill_order_item_append()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, public, app
as $$
declare
  v_session_status text;
  v_closed_at timestamptz;
begin
  if new.order_id is null then
    return new;
  end if;

  select s.status, s.closed_at
    into v_session_status, v_closed_at
  from public.table_bill_sessions s
  where s.tenant_id = new.tenant_id
    and s.branch_id = new.branch_id
    and s.order_id = new.order_id
  order by
    case when s.status in ('open', 'ordering', 'pending_payment') then 0 else 1 end,
    s.opened_at desc
  limit 1;

  if found and (v_closed_at is not null or v_session_status not in ('open', 'ordering')) then
    raise exception 'TABLE_SESSION_CLOSED';
  end if;

  return new;
end;
$$;

revoke all on function app.guard_table_bill_order_item_append() from public, anon, authenticated, service_role;

drop trigger if exists trg_order_items_guard_table_bill_append on public.order_items;
create trigger trg_order_items_guard_table_bill_append
before insert on public.order_items
for each row
execute function app.guard_table_bill_order_item_append();

create or replace function app.set_table_payment_lock_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_table_id uuid,
  p_order_id uuid,
  p_locked boolean default true
)
returns table(
  table_session_id uuid,
  table_id uuid,
  order_id uuid,
  status text
)
language plpgsql
security definer
set search_path to pg_catalog, public, app
set lock_timeout to '5s'
as $$
#variable_conflict use_column
declare
  v_session public.table_bill_sessions%rowtype;
  v_table public.dining_tables%rowtype;
  v_order_status text;
  v_next_status text := case when coalesce(p_locked, true) then 'pending_payment' else 'ordering' end;
begin
  if p_tenant_id is null or p_branch_id is null or p_table_id is null or p_order_id is null then
    raise exception 'INVALID_PAYMENT_LOCK_SCOPE';
  end if;

  select s.*
    into v_session
  from public.table_bill_sessions s
  where s.tenant_id = p_tenant_id
    and s.branch_id = p_branch_id
    and s.table_id = p_table_id
    and s.order_id = p_order_id
    and s.status in ('open', 'ordering', 'pending_payment')
    and s.closed_at is null
  order by s.opened_at desc
  limit 1
  for update;

  if not found then
    raise exception 'TABLE_SESSION_NOT_OPEN';
  end if;

  select dt.*
    into v_table
  from public.dining_tables dt
  where dt.tenant_id = p_tenant_id
    and dt.branch_id = p_branch_id
    and dt.id = p_table_id
  for update;

  if not found or v_table.is_active is not true or v_table.status in ('disabled', 'reserved') then
    raise exception 'TABLE_NOT_AVAILABLE';
  end if;

  select o.status::text
    into v_order_status
  from public.orders o
  where o.tenant_id = p_tenant_id
    and o.branch_id = p_branch_id
    and o.id = p_order_id
    and o.table_id = p_table_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if lower(coalesce(v_order_status, '')) in ('paid', 'closed', 'cleared', 'cancelled', 'completed') then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;

  update public.table_bill_sessions s
  set status = v_next_status,
      metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
        'payment_lock_updated_at', now(),
        'payment_lock_status', v_next_status
      )
  where s.id = v_session.id
    and s.tenant_id = p_tenant_id
    and s.branch_id = p_branch_id;

  update public.dining_tables dt
  set status = v_next_status
  where dt.id = p_table_id
    and dt.tenant_id = p_tenant_id
    and dt.branch_id = p_branch_id;

  return query
  select v_session.id, p_table_id, p_order_id, v_next_status;
end;
$$;

revoke all on function app.set_table_payment_lock_tx(uuid,uuid,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function app.set_table_payment_lock_tx(uuid,uuid,uuid,uuid,boolean) to service_role;

create or replace function public.set_table_payment_lock_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_table_id uuid,
  p_order_id uuid,
  p_locked boolean default true
)
returns table(
  table_session_id uuid,
  table_id uuid,
  order_id uuid,
  status text
)
language sql
security definer
set search_path to pg_catalog, public, app
as $$
  select *
  from app.set_table_payment_lock_tx($1, $2, $3, $4, $5);
$$;

revoke all on function public.set_table_payment_lock_tx(uuid,uuid,uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_table_payment_lock_tx(uuid,uuid,uuid,uuid,boolean) to service_role;
