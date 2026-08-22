create or replace function app.move_table_bill_session_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_source_table_id uuid,
  p_target_table_id uuid,
  p_reason text default null
)
returns table(
  order_id uuid,
  from_table_id uuid,
  to_table_id uuid,
  table_session_id uuid,
  session_status text,
  moved boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_session public.table_bill_sessions%rowtype;
  v_source_table public.dining_tables%rowtype;
  v_target_table public.dining_tables%rowtype;
  v_target_status text;
  v_now timestamptz := now();
begin
  if p_tenant_id is null or p_branch_id is null or p_source_table_id is null or p_target_table_id is null then
    raise exception 'INVALID_TABLE_MOVE_SCOPE';
  end if;

  select * into v_session
  from public.table_bill_sessions s
  where s.tenant_id = p_tenant_id
    and s.branch_id = p_branch_id
    and s.table_id = p_source_table_id
    and s.status in ('open','ordering','pending_payment')
    and s.closed_at is null
  order by s.opened_at desc
  limit 1
  for update;

  if not found then
    raise exception 'SOURCE_BILL_NOT_FOUND';
  end if;

  if p_source_table_id = p_target_table_id then
    return query
      select v_session.order_id, p_source_table_id, p_target_table_id, v_session.id, v_session.status, false;
    return;
  end if;

  select * into v_source_table
  from public.dining_tables t
  where t.tenant_id = p_tenant_id
    and t.branch_id = p_branch_id
    and t.id = p_source_table_id
  for update;
  if not found then
    raise exception 'SOURCE_TABLE_NOT_FOUND';
  end if;

  select * into v_target_table
  from public.dining_tables t
  where t.tenant_id = p_tenant_id
    and t.branch_id = p_branch_id
    and t.id = p_target_table_id
    and coalesce(t.is_active, true) = true
  for update;
  if not found then
    raise exception 'TARGET_TABLE_NOT_FOUND';
  end if;

  if exists (
    select 1
    from public.table_bill_sessions s
    where s.tenant_id = p_tenant_id
      and s.branch_id = p_branch_id
      and s.table_id = p_target_table_id
      and s.status in ('open','ordering','pending_payment')
      and s.closed_at is null
  ) then
    raise exception 'TARGET_TABLE_OCCUPIED';
  end if;

  if v_target_table.status in ('occupied','ordering','pending_payment') then
    raise exception 'TARGET_TABLE_OCCUPIED';
  end if;

  v_target_status := case
    when v_session.status = 'pending_payment' then 'pending_payment'
    when v_session.status = 'ordering' then 'ordering'
    else 'occupied'
  end;

  if v_session.order_id is not null then
    update public.orders o
    set table_id = p_target_table_id,
        updated_at = v_now
    where o.tenant_id = p_tenant_id
      and o.branch_id = p_branch_id
      and o.id = v_session.order_id;
    if not found then
      raise exception 'TABLE_MOVE_ORDER_NOT_FOUND';
    end if;

    update public.kitchen_tickets kt
    set table_id = p_target_table_id,
        updated_at = v_now,
        metadata = coalesce(kt.metadata, '{}'::jsonb) || jsonb_build_object(
          'moved_from_table_id', p_source_table_id,
          'moved_to_table_id', p_target_table_id,
          'table_moved_at', v_now
        )
    where kt.tenant_id = p_tenant_id
      and kt.branch_id = p_branch_id
      and kt.order_id = v_session.order_id
      and kt.status in ('queued','acknowledged','preparing');
  end if;

  update public.table_bill_sessions s
  set table_id = p_target_table_id,
      status = v_session.status,
      updated_at = v_now,
      metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
        'moved_from_table_id', p_source_table_id,
        'moved_to_table_id', p_target_table_id,
        'moved_by', p_actor_user_id,
        'moved_at', v_now,
        'move_reason', nullif(trim(coalesce(p_reason, '')), '')
      )
  where s.tenant_id = p_tenant_id
    and s.branch_id = p_branch_id
    and s.id = v_session.id;

  update public.table_qr_sessions qs
  set table_id = p_target_table_id,
      updated_at = v_now
  where qs.tenant_id = p_tenant_id
    and qs.branch_id = p_branch_id
    and qs.table_session_id = v_session.id
    and qs.status = 'active';

  update public.dining_tables
  set status = 'available',
      updated_at = v_now
  where tenant_id = p_tenant_id
    and branch_id = p_branch_id
    and id = p_source_table_id;

  update public.dining_tables
  set status = v_target_status,
      updated_at = v_now
  where tenant_id = p_tenant_id
    and branch_id = p_branch_id
    and id = p_target_table_id;

  return query
    select v_session.order_id, p_source_table_id, p_target_table_id, v_session.id, v_session.status, true;
end;
$$;

revoke all on function app.move_table_bill_session_tx(uuid,uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function app.move_table_bill_session_tx(uuid,uuid,uuid,uuid,uuid,text) to service_role;

create or replace function public.move_table_bill_session_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_actor_user_id uuid,
  p_source_table_id uuid,
  p_target_table_id uuid,
  p_reason text default null
)
returns table(
  order_id uuid,
  from_table_id uuid,
  to_table_id uuid,
  table_session_id uuid,
  session_status text,
  moved boolean
)
language sql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
  select *
  from app.move_table_bill_session_tx(
    p_tenant_id,
    p_branch_id,
    p_actor_user_id,
    p_source_table_id,
    p_target_table_id,
    p_reason
  );
$$;

revoke all on function public.move_table_bill_session_tx(uuid,uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.move_table_bill_session_tx(uuid,uuid,uuid,uuid,uuid,text) to service_role;