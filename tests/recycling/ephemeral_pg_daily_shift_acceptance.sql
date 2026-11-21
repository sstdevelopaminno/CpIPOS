set client_min_messages=warning;
do $qa$
declare
  v_t uuid:='11111111-1111-4111-8111-111111111111';
  v_b uuid:='22222222-2222-4222-8222-222222222222';
  v_cashier uuid:='33333333-3333-4333-8333-333333333333';
  v_shift uuid:='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v_mixed uuid:='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  v_cutoff timestamptz;v_count integer;v_meta jsonb;v_status text;
begin
  if has_function_privilege('anon','public.recycling_auto_close_daily_shifts_v1(integer)','EXECUTE')
    or has_function_privilege('authenticated','public.recycling_auto_close_daily_shifts_v1(integer)','EXECUTE') then
    raise exception 'UAT_WORKER_PUBLIC_EXECUTABLE';
  end if;
  if not exists(select 1 from cron.job where jobname='cpipos-recycling-daily-auto-close-v1'
    and schedule='* * * * *') then raise exception 'UAT_MISSING_CRON'; end if;
  -- Two old shifts; only the tagged tenant/branch may be closed. An open
  -- ordinary shift, created in the fixture, remains untouched.
  insert into public.shifts(id,tenant_id,branch_id,opened_at,opening_cash,status)
    values(v_shift,v_t,v_b,now()-interval '55 hours',100,'open'),
      (v_mixed,v_t,v_b,now()-interval '55 hours',100,'open');
  v_cutoff:=(((now()-interval '55 hours') at time zone 'Asia/Bangkok')::date+1)::timestamp
    at time zone 'Asia/Bangkok';
  -- Simulate a previously posted cash buy. Insert before applying daily mode
  -- metadata, because new transactions after cutoff are forbidden by trigger.
  insert into public.recycling_transactions(
    tenant_id,branch_id,shift_id,operator_user_id,request_id,receipt_no,
    request_hash,direction,settlement,counterparty_name,total_minor,cogs_minor,created_at
  ) values(
    v_t,v_b,v_shift,v_cashier,'abababab-abab-4aba-8aba-abababababab',
    'RCY-B-20261119-TESTTEST12',repeat('a',32),
    'buy','cash','Synthetic seller',2063,0,now()-interval '54 hours');
  update public.shifts set metadata='{"business_shift_mode":"recycling_daily","recycling_timezone":"Asia/Bangkok"}'::jsonb
    where id in (v_shift,v_mixed);
  -- A live unpaid ordinary POS bill must never be silently deleted/VOIDed.
  insert into public.orders(id,tenant_id,branch_id,shift_id)
    values('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb0',v_t,v_b,v_mixed);
  -- Manual close without cash count still fails for a shift with transactions.
  begin
    update public.shifts set status='closed',actual_cash=null where id=v_shift;
    raise exception 'UAT_MANUAL_NO_COUNT_ALLOWED';
  exception when others then
    if position('recycling_shift_cash_count_required' in sqlerrm)=0 then raise; end if;
  end;
  -- Server atomic insert cut-off guard rejects late purchases.
  begin
    perform public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
      'abababab-abab-4aba-8aba-abababababac','buy','cash','After midnight',
      jsonb_build_array(jsonb_build_object('product_id',
        '55555555-5555-4555-8555-555555555555','quantity',1,'unit','kg','expected_price',8.25)));
    raise exception 'UAT_LATE_RECYCLING_POST_ALLOWED';
  exception when others then
    if position('recycling_shift_daily_cutoff' in sqlerrm)=0 then raise; end if;
  end;
  perform * from public.recycling_auto_close_daily_shifts_v1(20);
  select status,metadata into v_status,v_meta from public.shifts where id=v_shift;
  if v_status<>'closed' or v_meta->>'system_auto_closed'<>'true'
    or v_meta->>'cash_count_required'<>'true'
    or v_meta->>'recycling_cash_in_minor'<>'0'
    or v_meta->>'recycling_cash_out_minor'<>'2063'
    or v_meta->>'recycling_expected_cash_minor'<>'7937'
    or v_meta->>'recycling_cash_count_reconciled'<>'false'
  then raise exception 'UAT_BAD_AUTOCLOSE_SUMMARY: % %',v_status,v_meta; end if;
  if (select actual_cash from public.shifts where id=v_shift) is not null
    or (select expected_cash from public.shifts where id=v_shift) is not null then
    raise exception 'UAT_FABRICATED_CASH_COUNT'; end if;
  if (select status from public.shifts where id=v_mixed)<>'open'
    or (select count(*) from public.orders where shift_id=v_mixed)<>1 then
    raise exception 'UAT_MIXED_POS_BILL_DELETED'; end if;
  if (select status from public.shifts
    where id='88888888-8888-4888-8888-888888888888')<>'closed' then
    raise exception 'UAT_LEGACY_SHIFT_MUTATED'; end if;
  perform * from public.recycling_auto_close_daily_shifts_v1(20);
  select count(*) into v_count from public.recycling_shift_auto_close_events where shift_id=v_shift;
  if v_count<>1 then raise exception 'UAT_NON_IDEMPOTENT_AUTOCLOSE';end if;
  raise notice 'RECYCLING_DAILY_SHIFT_ACCEPTANCE_SUCCESS';
end;
$qa$;
