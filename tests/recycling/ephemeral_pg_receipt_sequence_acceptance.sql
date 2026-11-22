-- Disposable PostgreSQL 16 CI database ONLY. Never execute this fixture
-- in Supabase Production. All identities and financial transactions are fake.
set client_min_messages=warning;

do $recycling_seq_uat$
declare
  v_t uuid := '11111111-1111-4111-8111-111111111111';
  v_first text;
  v_second text;
  v_third text;
  v_last bigint;
  v_old_count integer;
  v_function_sql text;
begin
  if exists (select 1 from pg_catalog.pg_class c
    where c.oid='public.recycling_receipt_counters'::regclass
      and not c.relrowsecurity) then
    raise exception 'UAT_SEQUENCE_RLS_MISSING';
  end if;
  if pg_catalog.has_function_privilege('anon','public.recycling_allocate_receipt_no(uuid)','EXECUTE') or
     pg_catalog.has_function_privilege('authenticated','public.recycling_allocate_receipt_no(uuid)','EXECUTE') then
    raise exception 'UAT_SEQUENCE_PUBLIC_FUNCTION_EXPOSED';
  end if;
  select count(*) into v_old_count from public.recycling_transactions
    where tenant_id=v_t and receipt_no ~ '^RCY-[BS]-[0-9]{8}-[0-9a-f]{12}$';
  if v_old_count=0 then raise exception 'UAT_HISTORICAL_NUMBER_MISSING'; end if;

  v_first:=public.recycling_allocate_receipt_no(v_t);
  v_second:=public.recycling_allocate_receipt_no(v_t);
  if v_first<>'RCY-0001' or v_second<>'RCY-0002' then
    raise exception 'UAT_SEQUENCE_NOT_MONOTONIC: %, %',v_first,v_second; end if;

  -- Simulate an aborted financial posting with a nested exception rollback.
  begin
    perform public.recycling_allocate_receipt_no(v_t);
    raise exception 'UAT_ROLLBACK_SENTINEL';
  exception when raise_exception then
    if sqlerrm<>'UAT_ROLLBACK_SENTINEL' then raise; end if;
  end;
  v_third:=public.recycling_allocate_receipt_no(v_t);
  if v_third<>'RCY-0003' then
    raise exception 'UAT_SEQUENCE_ABORTED_ALLOCATION_LEAK: %',v_third; end if;
  select last_number into v_last from public.recycling_receipt_counters where tenant_id=v_t;
  if v_last<>3 then raise exception 'UAT_SEQUENCE_COUNTER_WRONG: %',v_last; end if;

  select pg_catalog.pg_get_functiondef(p.oid) into v_function_sql
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='recycling_post_transaction';
  if position('v_receipt_no := public.recycling_allocate_receipt_no(p_tenant_id)' in v_function_sql)=0
     or position('recycling_cash_drawer_insufficient' in v_function_sql)=0 then
    raise exception 'UAT_SEQUENCE_ATOMIC_RPC_REGRESSION'; end if;
  if (select count(*) from public.recycling_transactions
      where tenant_id=v_t and receipt_no ~ '^RCY-[BS]-[0-9]{8}-[0-9a-f]{12}$')<>v_old_count then
    raise exception 'UAT_HISTORICAL_NUMBERS_MODIFIED'; end if;
  raise notice 'PASS: tenant-wide short document numbers, rollback and legacy identifiers';
end;
$recycling_seq_uat$;
