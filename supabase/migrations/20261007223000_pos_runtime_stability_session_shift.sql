-- POS runtime stability hardening.
-- Keeps active cashier sessions alive, moves shift auto-close authority to the server,
-- and restores compatibility for stale clients that still request tenants.metadata.

alter table public.tenants
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create or replace function app.pos_shift_auto_close_deadline(p_opened_at timestamptz)
returns timestamptz
language sql
stable
set search_path = pg_catalog
as $$
  with src as (
    select p_opened_at at time zone 'Asia/Bangkok' as opened_local
  ), parts as (
    select
      date_trunc('day', opened_local) as day_local,
      extract(hour from opened_local)::integer as opened_hour
    from src
  )
  select (
    case
      when opened_hour < 12 then day_local + interval '13 hours 45 minutes'
      when opened_hour < 18 then day_local + interval '18 hours 45 minutes'
      else day_local + interval '1 day 45 minutes'
    end
  ) at time zone 'Asia/Bangkok'
  from parts;
$$;

revoke all on function app.pos_shift_auto_close_deadline(timestamptz) from public, anon, authenticated;
grant execute on function app.pos_shift_auto_close_deadline(timestamptz) to service_role;

create or replace function app.auto_close_overdue_pos_shifts(p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_shift record;
  v_closed integer := 0;
  v_deferred integer := 0;
begin
  for v_shift in
    select
      s.id, s.tenant_id, s.branch_id, s.opened_by, s.opened_at,
      s.device_code, s.metadata
    from public.shifts s
    join public.tenants t on t.id = s.tenant_id
    where s.status::text = 'open'
      and t.is_active = true
      and app.pos_shift_auto_close_deadline(s.opened_at) <= p_as_of
    order by s.opened_at
    for update of s skip locked
  loop
    if exists (
      select 1
      from public.table_bill_sessions tb
      where tb.tenant_id = v_shift.tenant_id
        and tb.branch_id = v_shift.branch_id
        and lower(coalesce(tb.status::text,'')) not in ('closed','cancelled','canceled','voided')
    ) or exists (
      select 1
      from public.orders o
      where o.tenant_id = v_shift.tenant_id
        and o.branch_id = v_shift.branch_id
        and o.shift_id = v_shift.id
        and lower(coalesce(o.status::text,'')) not in ('completed','cancelled','canceled','voided','closed')
    ) then
      v_deferred := v_deferred + 1;
      continue;
    end if;

    update public.shifts
    set
      status = 'closed',
      closed_by = v_shift.opened_by,
      closed_at = p_as_of,
      closing_cash = null,
      expected_cash = null,
      actual_cash = null,
      metadata = coalesce(v_shift.metadata, '{}'::jsonb) || jsonb_build_object(
        'closed_via','server_shift_scheduler',
        'close_reason','system_auto_close_overdue_shift',
        'overdue_auto_close',true,
        'system_auto_closed',true,
        'server_auto_closed',true,
        'cash_count_required',false,
        'auto_close_uses_sales_total',true,
        'manager_approval_required',false,
        'session_preserved',true,
        'scheduled_auto_close_at',app.pos_shift_auto_close_deadline(v_shift.opened_at),
        'server_auto_closed_at',p_as_of
      ),
      updated_at = p_as_of
    where id = v_shift.id
      and status::text = 'open';

    if found then
      update public.pos_sessions
      set shift_id = null, updated_at = p_as_of
      where tenant_id = v_shift.tenant_id
        and branch_id = v_shift.branch_id
        and shift_id = v_shift.id
        and status = 'active';
      v_closed := v_closed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'closed', v_closed,
    'deferred_open_bills', v_deferred,
    'ran_at', p_as_of
  );
end;
$$;

revoke all on function app.auto_close_overdue_pos_shifts(timestamptz) from public, anon, authenticated;
grant execute on function app.auto_close_overdue_pos_shifts(timestamptz) to service_role;

create or replace function app.refresh_active_pos_session_leases(
  p_as_of timestamptz default now(),
  p_lease_hours integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_hours integer := greatest(12, least(coalesce(p_lease_hours,24),72));
  v_extended integer := 0;
begin
  update public.pos_sessions ps
  set
    expires_at = p_as_of + make_interval(hours => v_hours),
    updated_at = p_as_of
  where ps.status = 'active'
    and ps.expires_at > p_as_of
    and ps.expires_at <= p_as_of + interval '6 hours'
    and exists (
      select 1
      from public.branch_devices bd
      where bd.tenant_id = ps.tenant_id
        and bd.branch_id = ps.branch_id
        and bd.is_active = true
        and bd.status = 'active'
        and bd.last_seen_at >= p_as_of - interval '6 minutes'
        and (
          (ps.device_id is not null and bd.id = ps.device_id)
          or
          (ps.device_code is not null and upper(bd.device_code) = upper(ps.device_code))
        )
    );
  get diagnostics v_extended = row_count;

  return jsonb_build_object(
    'extended', v_extended,
    'lease_hours', v_hours,
    'ran_at', p_as_of
  );
end;
$$;

revoke all on function app.refresh_active_pos_session_leases(timestamptz,integer) from public, anon, authenticated;
grant execute on function app.refresh_active_pos_session_leases(timestamptz,integer) to service_role;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='cpipos_shift_autoclose_1m' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;

  select jobid into v_job from cron.job where jobname='cpipos_session_lease_1m' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;

  perform cron.schedule(
    'cpipos_shift_autoclose_1m',
    '* * * * *',
    'select app.auto_close_overdue_pos_shifts(now());'
  );

  perform cron.schedule(
    'cpipos_session_lease_1m',
    '* * * * *',
    'select app.refresh_active_pos_session_leases(now(),24);'
  );
end $$;
