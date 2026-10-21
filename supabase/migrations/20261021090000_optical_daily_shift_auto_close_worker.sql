-- CUSTOM Optical only: local-midnight, tenant-opted-in, idempotent server-side close.
-- Never assume a counted drawer; cash reconciliation remains explicitly pending.
-- Other POS packages and stores without the IT auto-close flag are unaffected.
create table if not exists public.optical_shift_auto_close_events (
  shift_id uuid primary key references public.shifts(id),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  business_day_cutoff_at timestamptz not null,
  processed_at timestamptz not null default now(),
  currency_code text not null check(currency_code='LAK'),
  opening_cash numeric(18,2) not null,
  legacy_cash numeric(18,2) not null,
  optical_cash numeric(18,2) not null,
  optical_transfer numeric(18,2) not null,
  deposit_received numeric(18,2) not null,
  expected_cash numeric(18,2) not null,
  cash_count_required boolean not null default true
);
alter table public.optical_shift_auto_close_events enable row level security;
revoke all on public.optical_shift_auto_close_events from public,anon,authenticated;
grant select,insert on public.optical_shift_auto_close_events to service_role;

create or replace function public.optical_auto_close_daily_shifts_v2(p_limit integer default 20)
returns table(closed_shift_id uuid,business_day_cutoff_at timestamptz,expected_cash numeric)
language plpgsql security definer
set search_path to 'pg_catalog','public','pg_temp'
as $worker$
declare
  v record;
  v_cutoff timestamptz;
  v_blockers integer;
  v_legacy_cash numeric(18,2);
  v_optical_cash numeric(18,2);
  v_optical_transfer numeric(18,2);
  v_deposits numeric(18,2);
  v_expected numeric(18,2);
begin
  if p_limit is null or p_limit<1 or p_limit>100 then
    raise exception 'OPTICAL_AUTO_CLOSE_LIMIT_INVALID';
  end if;
  for v in
    select s.id,s.tenant_id,s.branch_id,s.opened_at,s.opening_cash,s.metadata
    from public.shifts s
    join public.tenants t on t.id=s.tenant_id and t.is_active=true
    join lateral (
      select c.package_id,c.metadata,c.status,c.ended_at
      from public.tenant_subscription_contracts c
      where c.tenant_id=s.tenant_id and c.status in ('trial','active')
        and (c.ended_at is null or c.ended_at>now())
      order by c.created_at desc limit 1
    ) c on true
    join public.subscription_packages pkg on pkg.id=c.package_id
    where s.status='open'
      and s.metadata->>'business_shift_mode'='optical_daily'
      and s.metadata->>'optical_currency'='LAK'
      and s.metadata->>'optical_country'='LA'
      and s.metadata->>'optical_timezone'='Asia/Vientiane'
      and lower(pkg.code)='custom'
      and c.metadata->'sales_modes'->>'optical_retail'='true'
      and c.metadata->'custom_features'->>'optical_work_orders'='true'
      and c.metadata->'custom_features'->>'optical_deposit'='true'
      and c.metadata->'custom_features'->>'optical_daily_auto_close'='true'
      and c.metadata->>'pos_currency_code'='LAK'
      and coalesce(c.metadata->>'pos_country_code','LA')='LA'
      and coalesce(c.metadata->>'pos_timezone','Asia/Vientiane')='Asia/Vientiane'
      and (
        select count(*) from public.tenant_subscription_contracts c2
        where c2.tenant_id=s.tenant_id
          and c2.status in ('active','trial')
          and (c2.ended_at is null or c2.ended_at>now())
      )=1
      and now() >= (
        date_trunc('day',s.opened_at at time zone 'Asia/Vientiane')+interval '1 day'
      ) at time zone 'Asia/Vientiane'
    order by s.opened_at,s.id
    limit p_limit for update of s skip locked
  loop
    v_cutoff := (
      date_trunc('day',v.opened_at at time zone 'Asia/Vientiane')+interval '1 day'
    ) at time zone 'Asia/Vientiane';
    -- Do not suppress unsettled bills, late payments, or mixed-currency evidence.
    select count(*) into v_blockers from public.orders o
    where o.tenant_id=v.tenant_id and o.branch_id=v.branch_id
      and o.shift_id=v.id
      and (o.status not in ('completed','cancelled') or o.created_at>=v_cutoff);
    if v_blockers>0 then continue; end if;
    select count(*) into v_blockers from public.table_bill_sessions b
    where b.tenant_id=v.tenant_id and b.branch_id=v.branch_id
      and b.status in ('open','ordering','pending_payment');
    if v_blockers>0 then continue; end if;
    select count(*) into v_blockers from public.optical_payment_ledger l
    where l.tenant_id=v.tenant_id and l.branch_id=v.branch_id and l.shift_id=v.id
      and (l.received_at>=v_cutoff or l.received_at<v.opened_at
        or l.amount<=0 or l.currency_code<>'LAK'
        or l.method not in ('cash','bank_transfer')
        or (l.method='bank_transfer' and (l.verified_by is null or nullif(trim(l.reference_no),'') is null)));
    if v_blockers>0 then continue; end if;
    -- A work order must exist and be scoped to this tenant/branch; a deposit
    -- is cash received, not completed revenue, and is not added twice.
    select count(*) into v_blockers from public.optical_payment_ledger l
    left join public.optical_work_orders w
      on w.id=l.work_order_id and w.tenant_id=l.tenant_id and w.branch_id=l.branch_id
    where l.tenant_id=v.tenant_id and l.branch_id=v.branch_id and l.shift_id=v.id
      and (w.id is null or w.currency_code<>'LAK');
    if v_blockers>0 then continue; end if;
    select coalesce(sum(p.amount) filter(where p.method='cash'),0)
    into v_legacy_cash
    from public.orders o join public.payments p
      on p.order_id=o.id and p.tenant_id=o.tenant_id and p.branch_id=o.branch_id
    where o.tenant_id=v.tenant_id and o.branch_id=v.branch_id
      and o.shift_id=v.id and o.status='completed'
      and p.status='paid' and p.created_at<v_cutoff;
    select coalesce(sum(l.amount) filter(where l.method='cash'),0),
           coalesce(sum(l.amount) filter(where l.method='bank_transfer'),0),
           coalesce(sum(l.amount) filter(where l.cumulative_paid<w.total_amount),0)
    into v_optical_cash,v_optical_transfer,v_deposits
    from public.optical_payment_ledger l join public.optical_work_orders w
      on w.id=l.work_order_id and w.tenant_id=l.tenant_id and w.branch_id=l.branch_id
    where l.tenant_id=v.tenant_id and l.branch_id=v.branch_id
      and l.shift_id=v.id and l.received_at>=v.opened_at and l.received_at<v_cutoff;
    if v.opening_cash is null or v.opening_cash<0 then continue; end if;
    v_expected:=round(v.opening_cash+v_legacy_cash+v_optical_cash,2);
    insert into public.optical_shift_auto_close_events(
      shift_id,tenant_id,branch_id,business_day_cutoff_at,
      currency_code,opening_cash,legacy_cash,optical_cash,optical_transfer,
      deposit_received,expected_cash
    ) values (
      v.id,v.tenant_id,v.branch_id,v_cutoff,'LAK',v.opening_cash,
      v_legacy_cash,v_optical_cash,v_optical_transfer,v_deposits,v_expected
    ) on conflict(shift_id) do nothing;
    -- Both expected/actual are NULL because no one has counted the drawer.
    -- The exact expected amount and business-day cutoff are in the event and metadata.
    -- Closing guard still protects any unpaid dine-in orders.
    update public.shifts s set
      status='closed',closed_at=now(),closed_by=null,
      expected_cash=null,actual_cash=null,closing_cash=null,
      metadata=coalesce(s.metadata,'{}'::jsonb)||jsonb_build_object(
        'close_reason','optical_daily_auto_close_midnight',
        'system_auto_closed',true,
        'business_day_cutoff_at',v_cutoff,
        'closed_processed_at',now(),
        'cash_count_required',true,
        'optical_expected_cash_lak',v_expected,
        'optical_deposit_received_lak',v_deposits,
        'optical_cash_received_lak',v_optical_cash,
        'optical_transfer_received_lak',v_optical_transfer
      )
    where s.id=v.id and s.tenant_id=v.tenant_id and
      s.branch_id=v.branch_id and s.status='open';
    if not found then raise exception 'OPTICAL_CLOSE_CONCURRENT_UPDATE'; end if;
    update public.pos_sessions s set shift_id=null
    where s.tenant_id=v.tenant_id and s.branch_id=v.branch_id
      and s.shift_id=v.id and s.status='active';
    closed_shift_id:=v.id;
    business_day_cutoff_at:=v_cutoff;
    expected_cash:=v_expected;
    return next;
  end loop;
end;
$worker$;
revoke all on function public.optical_auto_close_daily_shifts_v2(integer)
  from public,anon,authenticated;
grant execute on function public.optical_auto_close_daily_shifts_v2(integer) to service_role;

do $schedule$
begin
  if not exists(select 1 from cron.job where jobname='cpipos-optical-daily-auto-close-v2') then
    perform cron.schedule('cpipos-optical-daily-auto-close-v2','* * * * *',
      'select * from public.optical_auto_close_daily_shifts_v2(20);');
  end if;
end;
$schedule$;
