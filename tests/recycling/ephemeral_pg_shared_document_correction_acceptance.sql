-- Isolated test for direct POS -> Finance -> POS edits of same transaction.
begin;
insert into public.products(id,tenant_id,branch_id,sku,name,category,price,sell_unit,metadata)
values('d2000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','SYNTHETIC-CORRECTION','Synthetic material','UAT',100.25,'piece','{"business_mode":"recycling","recycling_price_basis":"piece","recycling_price_unit":"piece","recycling_buy_price":75.50}');
insert into public.shifts(id,tenant_id,branch_id,opening_cash,status,metadata)
values('d2000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',1000,'open','{"business_shift_mode":"recycling_daily"}');
do $uat$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
 u uuid:='33333333-3333-4333-8333-333333333333';
 a uuid:='44444444-4444-4444-8444-444444444444';
 s uuid:='d2000000-0000-4000-8000-000000000002';
 p uuid:='d2000000-0000-4000-8000-000000000001';
 txid uuid; actual_at timestamptz;
 d1 timestamptz:=now()-interval '2 days';
 d2 timestamptz:=now()-interval '1 day';
 r uuid:=gen_random_uuid();
 result jsonb;
begin
 result:=public.recycling_post_transaction_vat(t,b,s,u,gen_random_uuid(),'buy','cash','Synthetic supplier',
  jsonb_build_array(jsonb_build_object('product_id',p,'unit','piece','quantity',2,'expected_price',75.50)));
 txid:=(result->>'id')::uuid;
 select created_at into strict actual_at from public.recycling_transactions where id=txid;
 begin
  perform public.recycling_correct_document_time(t,b,txid,u,gen_random_uuid(),actual_at,d1,'Synthetic staff correction attempt','pos');
  raise exception 'CORRECTION_STAFF_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_correction_forbidden%' then raise; end if; end;
 update public.user_branch_roles set role='owner' where tenant_id=t and branch_id=b and user_id=u;
 insert into public.finance_accounting_periods(tenant_id,branch_id,period_month,locked_at,locked_by)
 values(t,b,date_trunc('month',d1 at time zone 'Asia/Bangkok')::date,now(),a)
 on conflict(tenant_id,branch_id,period_month) do update set locked_at=excluded.locked_at,locked_by=excluded.locked_by;
 begin
  perform public.recycling_correct_document_time(t,b,txid,u,gen_random_uuid(),actual_at,d1,'Locked period must stay unchanged','pos');
  raise exception 'CORRECTION_LOCKED_PERIOD_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_correction_period_locked%' then raise; end if; end;
 update public.finance_accounting_periods set locked_at=null,locked_by=null where tenant_id=t and branch_id=b and period_month=date_trunc('month',d1 at time zone 'Asia/Bangkok')::date;
 result:=public.recycling_correct_document_time(t,b,txid,u,r,actual_at,d1,'Owner corrects document date','pos');
 if result->>'applied'<>'true' then raise exception 'CORRECTION_POS_FAILED'; end if;
 result:=public.recycling_correct_document_time(t,b,txid,u,r,actual_at,d1,'Owner corrects document date','pos');
 if result->>'idempotent'<>'true' then raise exception 'CORRECTION_RETRY_FAILED'; end if;
 result:=public.recycling_correct_document_time(t,b,txid,a,gen_random_uuid(),d1,d2,'Accountant corrects document date','finance');
 if result->>'applied'<>'true' then raise exception 'CORRECTION_FINANCE_FAILED'; end if;
 if not exists(select 1 from public.recycling_transactions where id=txid and effective_document_at=d2 and created_at=actual_at and total_minor=15100) then raise exception 'CORRECTION_CANONICAL_ROW_FAILED'; end if;
 if not exists(select 1 from public.recycling_stock_balances where tenant_id=t and branch_id=b and product_id=p and quantity_base=2 and carrying_cost_minor=15100) then raise exception 'CORRECTION_STOCK_CHANGED'; end if;
 if (select count(*) from public.recycling_document_corrections where transaction_id=txid)<>2 then raise exception 'CORRECTION_AUDIT_FAILED'; end if;
 begin
  perform public.recycling_correct_document_time(t,b,txid,u,gen_random_uuid(),actual_at,d1,'Stale client correction attempt','pos');
  raise exception 'CORRECTION_STALE_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_correction_conflict%' then raise; end if; end;
 if has_function_privilege('authenticated','public.recycling_correct_document_time(uuid,uuid,uuid,uuid,uuid,timestamptz,timestamptz,text,text)','execute') then raise exception 'CORRECTION_RPC_EXPOSED'; end if;
 raise notice 'PASS: POS and Finance correct one canonical document, original posting time and stock intact, retries safe';
end;
$uat$;
rollback;
