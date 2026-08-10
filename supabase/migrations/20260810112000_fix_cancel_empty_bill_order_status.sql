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

  if not found then
    raise exception 'TABLE_BILL_NOT_OPEN';
  end if;

  if v_session.order_id is not null then
    raise exception 'TABLE_BILL_NOT_EMPTY';
  end if;

  if exists (
    select 1
    from public.orders o
    where o.tenant_id = p_tenant_id
      and o.branch_id = p_branch_id
      and o.table_id = p_table_id
      and o.status not in ('cancelled', 'completed')
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
  set status = 'available',
      updated_at = now()
  where t.id = p_table_id
    and t.tenant_id = p_tenant_id
    and t.branch_id = p_branch_id;

  return query select v_session.id, p_table_id, true;
end;
$$;

revoke all on function app.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app.cancel_empty_table_bill_session_tx(uuid, uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
