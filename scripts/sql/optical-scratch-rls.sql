-- Execute AFTER synthetic deposit and concurrency tests; no real customer data.
\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000101';

do $owner$
declare n integer; cash numeric; fulfilled numeric;
begin
  select count(*) into n from public.optical_work_orders;
  if n < 2 then raise exception 'optical owner cannot see branch records'; end if;
  select amount_lak into cash from public.optical_report_v1(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000011',
    '2000-01-01'::timestamptz,'2100-01-01'::timestamptz)
   where metric='payment_received';
  if cash <> 1700 then raise exception 'owner cashflow not reconciled: %',cash; end if;
  select amount_lak into fulfilled from public.optical_report_v1(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000011',
    '2000-01-01'::timestamptz,'2100-01-01'::timestamptz)
   where metric='fulfilled_sales';
  if fulfilled <> 1000 then raise exception 'owner fulfilment counted deposits incorrectly: %',fulfilled; end if;
end
$owner$;

-- Owner of a completely different food tenant cannot view Optical QA data.
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000102';
do $other$
declare n integer;
begin
  select count(*) into n from public.optical_work_orders;
  if n<>0 then raise exception 'cross-tenant Optical work orders leaked: %',n; end if;
  select count(*) into n from public.optical_payment_ledger;
  if n<>0 then raise exception 'cross-tenant deposits leaked: %',n; end if;
  select count(*) into n from public.optical_stock_bins;
  if n<>0 then raise exception 'cross-tenant inventory leaked: %',n; end if;
  begin
    perform public.optical_report_v1(
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000011',
      '2000-01-01'::timestamptz,'2100-01-01'::timestamptz);
    raise exception 'EXPECTED_REPORT_DENIAL';
  exception when others then
    if SQLERRM<>'OPTICAL_REPORT_OWNER_REQUIRED' then
      raise exception 'report cross-tenant denied unexpectedly: %',SQLERRM;
    end if;
  end;
end
$other$;

-- No JWT == no access, even with the table name known.
set request.jwt.claim.sub='';
do $anonymous$
begin
  if (select count(*) from public.optical_work_orders)<>0 then
    raise exception 'unsigned user can read work orders'; end if;
  if (select count(*) from public.optical_payment_ledger)<>0 then
    raise exception 'unsigned user can read deposits'; end if;
end
$anonymous$;
reset role;
select 'optical_rls_scratch_passed' as outcome;
