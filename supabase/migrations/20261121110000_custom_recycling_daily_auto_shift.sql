-- CUSTOM Recycling only: audited end-of-business-day close (Asia/Bangkok).
-- Existing ordinary POS and CUSTOM Optical shift rules are preserved.
-- No deletion/VOID of real payments, purchases, orders, or drafts.
-- Cash is NOT claimed to have been counted by an unattended job.

create table if not exists public.recycling_shift_auto_close_events (
  shift_id uuid primary key references public.shifts(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  cutoff_at timestamptz not null,
  processed_at timestamptz not null default now(),
  buy_count bigint not null,
  sell_count bigint not null,
  cash_in_minor bigint not null,
  cash_out_minor bigint not null,
  transfer_in_minor bigint not null,
  transfer_out_minor bigint not null,
  expected_cash_minor bigint,
  cash_count_required boolean not null default true,
  constraint recycling_shift_auto_close_not_fake_count check (cash_count_required)
);
alter table public.recycling_shift_auto_close_events enable row level security;
revoke all on public.recycling_shift_auto_close_events from public,anon,authenticated;
grant select,insert on public.recycling_shift_auto_close_events to service_role;

-- A cashier using an already-overdue recycled shift must not win the
-- 00:00–00:01 job scheduling race; the transaction rolls back atomically.
create or replace function public.recycling_reject_overdue_shift_transaction()
returns trigger language plpgsql security definer set search_path='' as $guard$
declare v_opened timestamptz; v_mode text; v_cutoff timestamptz;
begin
  select s.opened_at,s.metadata->>'business_shift_mode'
    into v_opened,v_mode from public.shifts s
    where s.id=new.shift_id and s.tenant_id=new.tenant_id
      and s.branch_id=new.branch_id;
  if not found then raise exception 'recycling_shift_not_found'; end if;
  if v_mode='recycling_daily' then
    v_cutoff:=(((v_opened at time zone 'Asia/Bangkok')::date+1)::timestamp
      at time zone 'Asia/Bangkok');
    if now()>=v_cutoff then raise exception 'recycling_shift_daily_cutoff'; end if;
  end if;
  return new;
end;
$guard$;
revoke all on function public.recycling_reject_overdue_shift_transaction()
  from public,anon,authenticated;
grant execute on function public.recycling_reject_overdue_shift_transaction() to service_role;
drop trigger if exists recycling_daily_transaction_cutoff_guard on public.recycling_transactions;
create trigger recycling_daily_transaction_cutoff_guard
before insert on public.recycling_transactions for each row
execute function public.recycling_reject_overdue_shift_transaction();

-- Extend ONLY the existing Recycling close trigger. Real/manual closes still
-- REQUIRE a drawer count; a trusted transaction-local job marker permits
-- an unattended close with expected/actual cash left NULL and an audit trail.
create or replace function public.recycling_guard_shift_closure()
returns trigger language plpgsql security definer set search_path='' as $shiftclose$
declare
  v_count bigint; v_buy_count bigint; v_sell_count bigint;
  v_cash_in bigint; v_cash_out bigint; v_transfer_in bigint; v_transfer_out bigint;
  v_cash_net bigint; v_expected bigint;
  v_auto boolean;
begin
  if new.status <> 'closed' or old.status <> 'open' then return new; end if;
  select count(*),count(*) filter(where direction='buy'),
    count(*) filter(where direction='sell'),
    coalesce(sum(total_minor) filter(where direction='sell' and settlement='cash'),0),
    coalesce(sum(total_minor) filter(where direction='buy' and settlement='cash'),0),
    coalesce(sum(total_minor) filter(where direction='sell' and settlement='bank_transfer'),0),
    coalesce(sum(total_minor) filter(where direction='buy' and settlement='bank_transfer'),0)
  into v_count,v_buy_count,v_sell_count,v_cash_in,v_cash_out,
    v_transfer_in,v_transfer_out
  from public.recycling_transactions
  where tenant_id=new.tenant_id and branch_id=new.branch_id
    and shift_id=new.id and status='posted';
  v_cash_net:=v_cash_in-v_cash_out;
  if v_count=0 then return new; end if;
  if exists(select 1 from public.orders
    where tenant_id=new.tenant_id and branch_id=new.branch_id
      and shift_id=new.id limit 1) then
    raise exception 'recycling_mixed_legacy_shift_requires_reconciliation';
  end if;
  v_auto:=
    pg_catalog.current_setting('cpipos.recycling_auto_close',true)='1'
    and old.metadata->>'business_shift_mode'='recycling_daily'
    and new.metadata->>'close_reason'='recycling_daily_auto_close_midnight'
    and new.metadata->>'system_auto_closed'='true'
    and new.metadata->>'cash_count_required'='true'
    and new.closed_by is null and new.actual_cash is null;
  if (new.actual_cash is null or new.actual_cash<0) and not v_auto then
    raise exception 'recycling_shift_cash_count_required';
  end if;
  v_expected:=pg_catalog.round(coalesce(old.opening_cash,0)*100)::bigint+v_cash_net;
  if v_expected<0 and not v_auto then
    raise exception 'recycling_shift_negative_expected_cash';
  end if;
  -- NULL means no cashier performed a cash count. This is NOT a balanced drawer.
  new.expected_cash:=case when v_auto then null else v_expected::numeric/100 end;
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||pg_catalog.jsonb_build_object(
    'recycling_buy_count',v_buy_count,
    'recycling_sell_count',v_sell_count,
    'recycling_cash_in_minor',v_cash_in,
    'recycling_cash_out_minor',v_cash_out,
    'recycling_cash_net_minor',v_cash_net,
    'recycling_transfer_in_minor',v_transfer_in,
    'recycling_transfer_out_minor',v_transfer_out,
    'recycling_expected_cash_minor',case when old.opening_cash is null then null else v_expected end,
    'recycling_cash_count_reconciled',
      case when v_auto then false else pg_catalog.round(new.actual_cash*100)::bigint=v_expected end,
    'recycling_requires_cash_review',v_auto
  );
  return new;
end;
$shiftclose$;
revoke all on function public.recycling_guard_shift_closure()
  from public,anon,authenticated;
grant execute on function public.recycling_guard_shift_closure() to service_role;

-- Idempotent per-shift worker. Lock the shift row, which also serializes with
-- recycling_post_transaction and supervised VOID; never touch non-Recycling shifts.
create or replace function public.recycling_auto_close_daily_shifts_v1(p_limit integer default 20)
returns table(closed_shift_id uuid,business_day_cutoff_at timestamptz)
language plpgsql security definer set search_path='' as $worker$
declare
 v record; v_cutoff timestamptz; v_count bigint; v_buy bigint; v_sell bigint;
 v_cash_in bigint; v_cash_out bigint; v_transfer_in bigint; v_transfer_out bigint;
 v_expected bigint; v_mixed bigint; v_pending bigint;
begin
 if p_limit is null or p_limit<1 or p_limit>100 then
   raise exception 'RECYCLING_AUTO_CLOSE_INVALID_LIMIT';
 end if;
 for v in
   select s.id,s.tenant_id,s.branch_id,s.opened_at,s.opening_cash,s.metadata
   from public.shifts s
   join public.tenants t on t.id=s.tenant_id
   join lateral (select c.package_id,c.metadata,c.status
     from public.tenant_subscription_contracts c
     where c.tenant_id=s.tenant_id order by c.created_at desc limit 1) c on true
   join public.subscription_packages p on p.id=c.package_id
   where s.status='open'
     and s.metadata->>'business_shift_mode'='recycling_daily'
     and s.metadata->>'recycling_timezone'='Asia/Bangkok'
     and pg_catalog.lower(p.code)='custom'
     and c.status in ('active','trial')
     and c.metadata->'sales_modes'->>'recycling'='true'
     and coalesce(c.metadata->>'pos_timezone','Asia/Bangkok')='Asia/Bangkok'
     and now()>=(((s.opened_at at time zone 'Asia/Bangkok')::date+1)::timestamp
       at time zone 'Asia/Bangkok')
   order by s.opened_at,s.id limit p_limit for update of s skip locked
 loop
   v_cutoff:=(((v.opened_at at time zone 'Asia/Bangkok')::date+1)::timestamp
     at time zone 'Asia/Bangkok');
   -- Fail closed for any mixed ordinary POS order or unsettled table session.
   select count(*) into v_mixed from public.orders o where
     o.tenant_id=v.tenant_id and o.branch_id=v.branch_id and o.shift_id=v.id;
   if v_mixed>0 then continue; end if;
   select count(*) into v_pending from public.table_bill_sessions b
     where b.tenant_id=v.tenant_id and b.branch_id=v.branch_id
       and b.status in ('open','ordering','pending_payment');
   if v_pending>0 then continue; end if;
   -- No auto move/rebooking of a transaction posted after its business cutoff.
   select count(*) into v_pending from public.recycling_transactions t
    where t.tenant_id=v.tenant_id and t.branch_id=v.branch_id
      and t.shift_id=v.id and t.created_at>=v_cutoff;
   if v_pending>0 then continue; end if;
   select count(*),
     count(*) filter(where direction='buy'),
     count(*) filter(where direction='sell'),
     coalesce(sum(total_minor) filter(where direction='sell' and settlement='cash'),0),
     coalesce(sum(total_minor) filter(where direction='buy' and settlement='cash'),0),
     coalesce(sum(total_minor) filter(where direction='sell' and settlement='bank_transfer'),0),
     coalesce(sum(total_minor) filter(where direction='buy' and settlement='bank_transfer'),0)
    into v_count,v_buy,v_sell,v_cash_in,v_cash_out,v_transfer_in,v_transfer_out
    from public.recycling_transactions t where
      t.tenant_id=v.tenant_id and t.branch_id=v.branch_id
      and t.shift_id=v.id and t.status='posted';
   v_expected:=case when v.opening_cash is null then null else
     pg_catalog.round(v.opening_cash*100)::bigint+v_cash_in-v_cash_out end;
   begin
     perform pg_catalog.set_config('cpipos.recycling_auto_close','1',true);
     update public.shifts s set status='closed',closed_at=now(),
       closed_by=null,closing_cash=null,expected_cash=null,actual_cash=null,
       metadata=coalesce(s.metadata,'{}'::jsonb)||pg_catalog.jsonb_build_object(
         'business_shift_mode','recycling_daily',
         'recycling_timezone','Asia/Bangkok',
         'close_reason','recycling_daily_auto_close_midnight',
         'system_auto_closed',true,
         'cash_count_required',true,
         'business_day_cutoff_at',v_cutoff,
         'closed_processed_at',now(),
         'recycling_buy_count',v_buy,'recycling_sell_count',v_sell,
         'recycling_cash_in_minor',v_cash_in,'recycling_cash_out_minor',v_cash_out,
         'recycling_cash_net_minor',v_cash_in-v_cash_out,
         'recycling_transfer_in_minor',v_transfer_in,
         'recycling_transfer_out_minor',v_transfer_out,
         'recycling_expected_cash_minor',v_expected,
         'recycling_cash_count_reconciled',false,
         'recycling_requires_cash_review',true
       )
       where s.id=v.id and s.tenant_id=v.tenant_id
         and s.branch_id=v.branch_id and s.status='open';
     if not found then raise exception 'RECYCLING_CLOSE_CONCURRENT_UPDATE'; end if;
     insert into public.recycling_shift_auto_close_events(
       shift_id,tenant_id,branch_id,cutoff_at,buy_count,sell_count,
       cash_in_minor,cash_out_minor,transfer_in_minor,transfer_out_minor,expected_cash_minor
     ) values(v.id,v.tenant_id,v.branch_id,v_cutoff,v_buy,v_sell,
       v_cash_in,v_cash_out,v_transfer_in,v_transfer_out,v_expected)
     on conflict(shift_id) do nothing;
     update public.pos_sessions ps set shift_id=null
       where ps.tenant_id=v.tenant_id and ps.branch_id=v.branch_id
         and ps.shift_id=v.id and ps.status='active';
     closed_shift_id:=v.id;
     business_day_cutoff_at:=v_cutoff;
     return next;
   exception when others then
     -- Each shift is an isolated subtransaction. Keep blockers available for
     -- manager/accountant reconciliation; never erase or silently void bills.
     raise warning 'RECYCLING_SHIFT_AUTO_CLOSE_SKIPPED % %',v.id,sqlstate;
   end;
 end loop;
end;
$worker$;
revoke all on function public.recycling_auto_close_daily_shifts_v1(integer)
 from public,anon,authenticated;
grant execute on function public.recycling_auto_close_daily_shifts_v1(integer) to service_role;

do $cron$
begin
 if not exists (select 1 from cron.job where jobname='cpipos-recycling-daily-auto-close-v1') then
   perform cron.schedule('cpipos-recycling-daily-auto-close-v1','* * * * *',
      'select * from public.recycling_auto_close_daily_shifts_v1(20);');
 end if;
end;
$cron$;
