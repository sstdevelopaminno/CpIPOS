-- Serialize every table-bill order-item insert with checkout state changes.
-- FOR SHARE conflicts with the payment-lock transaction's row update, so callers
-- cannot observe a stale `ordering` state while checkout is committing.

create or replace function app.guard_table_bill_order_item_append()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, public, app
set lock_timeout to '5s'
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
  limit 1
  for share;

  if found and (v_closed_at is not null or v_session_status not in ('open', 'ordering')) then
    raise exception 'TABLE_SESSION_CLOSED';
  end if;

  return new;
end;
$$;

revoke all on function app.guard_table_bill_order_item_append() from public, anon, authenticated, service_role;
