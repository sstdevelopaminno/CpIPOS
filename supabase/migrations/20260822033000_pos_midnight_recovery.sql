-- Daily POS recovery guard for stale midnight table/bill shells.
-- Runs at 00:00 Asia/Bangkok (17:00 UTC) in each data plane.

create or replace function app.run_midnight_pos_recovery(p_stale_after interval default interval '18 hours')
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, public, app
as $$
declare
  v_started_at timestamptz := now();
  v_stale_after interval := greatest(coalesce(p_stale_after, interval '18 hours'), interval '6 hours');
  v_cutoff timestamptz := v_started_at - v_stale_after;
  v_cancelled_order_count integer := 0;
  v_cancelled_session_count integer := 0;
  v_released_table_count integer := 0;
  v_review_session_count integer := 0;
begin
  create temporary table if not exists pg_temp.pos_midnight_recovery_sessions(
    session_id uuid primary key,
    table_id uuid not null,
    order_id uuid,
    recovery_reason text not null
  ) on commit drop;

  truncate table pg_temp.pos_midnight_recovery_sessions;

  insert into pg_temp.pos_midnight_recovery_sessions(session_id, table_id, order_id, recovery_reason)
  select s.id, s.table_id, s.order_id, 'empty_linked_order'
  from public.table_bill_sessions s
  join public.orders o
    on o.id = s.order_id
   and o.tenant_id = s.tenant_id
   and o.branch_id = s.branch_id
  where s.status in ('open', 'ordering', 'pending_payment')
    and s.opened_at < v_cutoff
    and o.status::text in ('draft', 'queued', 'preparing')
    and not exists (
      select 1
      from public.payments p
      where p.tenant_id = o.tenant_id
        and p.branch_id = o.branch_id
        and p.order_id = o.id
    )
    and not exists (
      select 1
      from public.order_items oi
      where oi.tenant_id = o.tenant_id
        and oi.branch_id = o.branch_id
        and oi.order_id = o.id
        and oi.quantity > 0
        and coalesce(oi.metadata->>'bill_line_state', 'active') <> 'cancelled'
    )
  on conflict (session_id) do nothing;

  insert into pg_temp.pos_midnight_recovery_sessions(session_id, table_id, order_id, recovery_reason)
  select s.id, s.table_id, null, 'empty_table_session'
  from public.table_bill_sessions s
  where s.status in ('open', 'ordering', 'pending_payment')
    and s.opened_at < v_cutoff
    and s.order_id is null
  on conflict (session_id) do nothing;

  update public.orders o
  set status = 'cancelled',
      subtotal = 0,
      discount_amount = 0,
      gp_amount = 0,
      total_amount = 0,
      tax_total = 0,
      grand_total = 0,
      cancelled_reason = 'daily_midnight_pos_recovery_empty_order',
      metadata = coalesce(o.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'daily_midnight_recovery', true,
          'daily_midnight_recovery_reason', r.recovery_reason,
          'daily_midnight_recovery_at', v_started_at,
          'daily_midnight_recovery_stale_cutoff', v_cutoff
        ),
      updated_at = v_started_at
  from pg_temp.pos_midnight_recovery_sessions r
  where r.order_id is not null
    and o.id = r.order_id
    and o.status::text in ('draft', 'queued', 'preparing');
  get diagnostics v_cancelled_order_count = row_count;

  update public.table_bill_sessions s
  set status = 'cancelled',
      closed_at = v_started_at,
      metadata = coalesce(s.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'daily_midnight_recovery', true,
          'daily_midnight_recovery_reason', r.recovery_reason,
          'daily_midnight_recovery_at', v_started_at,
          'daily_midnight_recovery_stale_cutoff', v_cutoff
        ),
      updated_at = v_started_at
  from pg_temp.pos_midnight_recovery_sessions r
  where s.id = r.session_id
    and s.status in ('open', 'ordering', 'pending_payment');
  get diagnostics v_cancelled_session_count = row_count;

  update public.dining_tables dt
  set status = 'available',
      metadata = coalesce(dt.metadata, '{}'::jsonb)
        || jsonb_build_object('daily_midnight_recovery_released_at', v_started_at),
      updated_at = v_started_at
  where dt.status in ('occupied', 'ordering', 'pending_payment')
    and exists (
      select 1
      from pg_temp.pos_midnight_recovery_sessions r
      where r.table_id = dt.id
    )
    and not exists (
      select 1
      from public.table_bill_sessions s
      where s.table_id = dt.id
        and s.status in ('open', 'ordering', 'pending_payment')
    );
  get diagnostics v_released_table_count = row_count;

  update public.table_bill_sessions s
  set metadata = coalesce(s.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'daily_midnight_recovery_review_required', true,
          'daily_midnight_recovery_review_required_at', v_started_at,
          'daily_midnight_recovery_stale_cutoff', v_cutoff
        ),
      updated_at = v_started_at
  from public.orders o
  where s.order_id = o.id
    and s.tenant_id = o.tenant_id
    and s.branch_id = o.branch_id
    and s.status in ('open', 'ordering', 'pending_payment')
    and s.opened_at < v_cutoff
    and o.status::text in ('draft', 'queued', 'preparing')
    and (
      exists (
        select 1
        from public.payments p
        where p.tenant_id = o.tenant_id
          and p.branch_id = o.branch_id
          and p.order_id = o.id
      )
      or exists (
        select 1
        from public.order_items oi
        where oi.tenant_id = o.tenant_id
          and oi.branch_id = o.branch_id
          and oi.order_id = o.id
          and oi.quantity > 0
          and coalesce(oi.metadata->>'bill_line_state', 'active') <> 'cancelled'
      )
    );
  get diagnostics v_review_session_count = row_count;

  return jsonb_build_object(
    'started_at', v_started_at,
    'stale_cutoff', v_cutoff,
    'cancelled_order_count', v_cancelled_order_count,
    'cancelled_session_count', v_cancelled_session_count,
    'released_table_count', v_released_table_count,
    'review_session_count', v_review_session_count,
    'destructive_delete', false
  );
end;
$$;

revoke all on function app.run_midnight_pos_recovery(interval) from public, anon, authenticated;
grant execute on function app.run_midnight_pos_recovery(interval) to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
  begin
    perform cron.unschedule('cpipos_pos_midnight_recovery_daily');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'cpipos_pos_midnight_recovery_daily',
    '0 17 * * *',
    'select app.run_midnight_pos_recovery();'
  );
end $$;
