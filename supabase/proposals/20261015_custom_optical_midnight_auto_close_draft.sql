-- DRAFT / NOT DEPLOYED: CUSTOM Optical LAK auto-close at local midnight.
-- Depends on Optical work-order ledger + IT cutover proposals PR #276.
-- The 00:00 cutoff is authoritative even when pg_cron runs later.
-- NEVER apply/schedule before dry run, cash reconciliation QA, and IT approval.
-- Other packages and unapproved CUSTOM shops are not eligible.
create table if not exists public.optical_shift_auto_close_events (
  shift_id uuid primary key references public.shifts(id),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  business_day_cutoff_at timestamptz not null,
  closed_processed_at timestamptz not null default now(),
  currency_code text not null check(currency_code='LAK'),
  legacy_cash numeric(18,2) not null default 0,
  optical_cash numeric(18,2) not null default 0,
  optical_transfer numeric(18,2) not null default 0,
  deposit_received numeric(18,2) not null default 0,
  expected_cash numeric(18,2) not null,
  note text not null default 'Unattended close; actual drawer count pending.'
);
alter table public.optical_shift_auto_close_events enable row level security;
revoke all on public.optical_shift_auto_close_events from public,anon,authenticated;
grant select,insert on public.optical_shift_auto_close_events to service_role;

create or replace function public.optical_auto_close_daily_shifts_v1(p_limit integer default 20)
returns table(shift_id uuid,closed_at timestamptz,expected_cash numeric)
language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v record;
  v_cutoff timestamptz;
  v_bad integer;
  v_legacy_cash numeric(18,2);
  v_optical_cash numeric(18,2);
  v_optical_transfer numeric(18,2);
  v_deposit numeric(18,2);
  v_expected numeric(18,2);
begin
  if current_user<>'service_role' then
    raise exception 'OPTICAL_AUTO_CLOSE_SERVICE_ONLY';
  end if;
  if p_limit<1 or p_limit>100 then raise exception 'OPTICAL_BATCH_LIMIT_INVALID'; end if;
  -- PG row lock + status=open are the idempotency boundary, even with
  -- multiple scheduled runners. Only an IT-authorized CUSTOM LAK shop.
  for v in
    select s.id,s.tenant_id,s.branch_id,s.opened_at,s.opening_cash,s.metadata
      from public.shifts s
      join public.tenant_subscription_contracts c on c.tenant_id=s.tenant_id
      join public.subscription_packages pkg on pkg.id=c.package_id
      where s.status='open'
        and lower(pkg.code)='custom'
        and c.status in ('active','trial')
        and (c.ended_at is null or c.ended_at>now())
        and (select count(*) from public.tenant_subscription_contracts c2
           where c2.tenant_id=s.tenant_id and c2.status in ('active','trial')
             and (c2.ended_at is null or c2.ended_at>now()))=1
        and c.metadata->'sales_modes'->>'optical_retail'='true'
        and c.metadata->'custom_features'->>'optical_work_orders'='true'
        and c.metadata->'custom_features'->>'optical_deposit'='true'
        and c.metadata->'custom_features'->>'optical_daily_auto_close'='true'
        and c.metadata->>'pos_currency_code'='LAK'
        and coalesce(c.metadata->>'pos_country_code','LA')='LA'
        and coalesce(c.metadata->>'pos_timezone','Asia/Vientiane')='Asia/Vientiane'
      order by s.opened_at,s.id
      limit p_limit
      for update of s skip locked
  loop
    v_cutoff := (date_trunc('day',v.opened_at at time zone 'Asia/Vientiane')
       +interval '1 day') at time zone 'Asia/Vientiane';
    if now()<v_cutoff then continue; end if;
    -- Existing unpaid/queued standard POS bills cannot be cancelled or
    -- silently reassigned by this Optical-only worker.
    select count(*) into v_bad from public.orders o
       where o.tenant_id=v.tenant_id and o.branch_id=v.branch_id
         and o.shift_id=v.id and o.status not in ('completed','cancelled');
    if v_bad>0 then continue; end if;
    -- Any transaction attached to the old shift AFTER midnight requires
    -- manual reconciliation; do not discard it.
    select count(*) into v_bad from public.optical_payment_ledger l
      where l.tenant_id=v.tenant_id and l.branch_id=v.branch_id
        and l.shift_id=v.id and l.received_at>=v_cutoff;
    if v_bad>0 then continue; end if;
    select count(*) into v_bad from public.orders o
      where o.tenant_id=v.tenant_id and o.branch_id=v.branch_id
        and o.shift_id=v.id and o.created_at>=v_cutoff;
    if v_bad>0 then continue; end if;
    -- Refuse unverified money transfers or foreign currencies.
    select count(*) into v_bad from public.optical_payment_ledger l
      where l.tenant_id=v.tenant_id and l.branch_id=v.branch_id and l.shift_id=v.id
        and (l.currency_code<>'LAK'
          or (l.method='bank_transfer' and (l.verified_by is null or l.reference_no is null)));
    if v_bad>0 then continue; end if;
    select coalesce(sum(p.amount) filter(where p.method='cash'),0)
      into v_legacy_cash
      from public.orders o join public.payments p
        on p.order_id=o.id and p.tenant_id=o.tenant_id and p.branch_id=o.branch_id
      where o.tenant_id=v.tenant_id and o.branch_id=v.branch_id
        and o.shift_id=v.id and o.status='completed'
        and p.status='paid' and p.created_at<v_cutoff;
    select coalesce(sum(l.amount) filter(where l.method='cash'),0),
           coalesce(sum(l.amount) filter(where l.method='bank_transfer'),0),
           coalesce(sum(l.amount) filter(where l.cumulative_paid < w.total_amount),0)
      into v_optical_cash,v_optical_transfer,v_deposit
      from public.optical_payment_ledger l join public.optical_work_orders w
        on w.id=l.work_order_id and w.tenant_id=l.tenant_id and w.branch_id=l.branch_id
      where l.tenant_id=v.tenant_id and l.branch_id=v.branch_id
        and l.shift_id=v.id and l.received_at>=v.opened_at
        and l.received_at<v_cutoff and l.currency_code='LAK';
    v_expected:=round(coalesce(v.opening_cash,0)+v_legacy_cash+v_optical_cash,2);
    -- This audit insert and shift update are one transaction. A failed insert
    -- must roll back the state update; never set actual_cash=0 without counting.
    insert into public.optical_shift_auto_close_events(
      shift_id,tenant_id,branch_id,business_day_cutoff_at,
      legacy_cash,optical_cash,optical_transfer,deposit_received,expected_cash)
    values(v.id,v.tenant_id,v.branch_id,v_cutoff,
      v_legacy_cash,v_optical_cash,v_optical_transfer,v_deposit,v_expected)
    on conflict(shift_id) do nothing;
    update public.shifts s set
      status='closed',closed_at=v_cutoff,closed_by=null,
      expected_cash=v_expected,actual_cash=null,closing_cash=null,
      metadata=coalesce(s.metadata,'{}'::jsonb)||jsonb_build_object(
        'close_reason','optical_daily_auto_close_midnight',
        'system_auto_closed',true,'business_day_cutoff_at',v_cutoff,
        'closed_processed_at',now(),'cash_count_required',true,
        'optical_deposit_total_lak',v_deposit,
        'optical_cash_received_lak',v_optical_cash,
        'optical_transfer_received_lak',v_optical_transfer)
      where s.id=v.id and s.tenant_id=v.tenant_id
        and s.branch_id=v.branch_id and s.status='open';
    if found then
      shift_id:=v.id;closed_at:=v_cutoff;expected_cash:=v_expected;
      return next;
    end if;
  end loop;
end;
$$;
revoke all on function public.optical_auto_close_daily_shifts_v1(integer)
  from PUBLIC,anon,authenticated;
grant execute on function public.optical_auto_close_daily_shifts_v1(integer) to service_role;

-- AFTER approving and staging ALL dependencies, the database scheduler can
-- invoke this at one-minute cadence (not tied to any browser or Vercel):
-- SELECT cron.schedule('cpipos-optical-daily-midnight-v1','* * * * *',
--    $$SELECT * FROM public.optical_auto_close_daily_shifts_v1(20);$$);
-- DO NOT UNCOMMENT IN A PRODUCTION MIGRATION WITHOUT EXPLICIT APPROVAL.
