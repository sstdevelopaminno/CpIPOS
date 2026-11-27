-- Synthetic only: automatic/manual document time, retry safety and unchanged real posting chronology.
begin;
insert into public.products(id,tenant_id,branch_id,sku,name,category,price,sell_unit,metadata)
values('d1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','SYNTHETIC-DATE','Synthetic material','UAT',100.25,'piece','{"business_mode":"recycling","recycling_price_basis":"piece","recycling_price_unit":"piece","recycling_buy_price":75.50}');
insert into public.shifts(id,tenant_id,branch_id,opening_cash,status,metadata)
values('d1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',1000,'open','{"business_shift_mode":"recycling_daily"}');
do $uat$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
 u uuid:='33333333-3333-4333-8333-333333333333';
 s uuid:='d1000000-0000-4000-8000-000000000002';
 p uuid:='d1000000-0000-4000-8000-000000000001';
 r uuid:='d1000000-0000-4000-8000-000000000003';
 r2 uuid:='d1000000-0000-4000-8000-000000000004';
 d timestamptz:=now()-interval '2 days';
 l jsonb:=jsonb_build_array(jsonb_build_object('product_id',p,'unit','piece','quantity',2,'expected_price',75.50));
 result jsonb; repeat_result jsonb; normal jsonb;
begin
 result:=public.recycling_post_transaction_with_document_time(t,b,s,u,r,'buy','cash','Synthetic supplier',l,d);
 if not exists(select 1 from public.recycling_transactions where id=(result->>'id')::uuid and document_at=d and created_at>document_at) then raise exception 'MANUAL_DATE_NOT_SAVED'; end if;
 repeat_result:=public.recycling_post_transaction_with_document_time(t,b,s,u,r,'buy','cash','Synthetic supplier',l,d);
 if repeat_result->>'id'<>result->>'id' then raise exception 'DATE_RETRY_DUPLICATED'; end if;
 begin
  perform public.recycling_post_transaction_with_document_time(t,b,s,u,r,'buy','cash','Synthetic supplier',l,null);
  raise exception 'DATE_CONFLICT_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_document_time_conflict%' then raise; end if; end;
 normal:=public.recycling_post_transaction_with_document_time(t,b,s,u,r2,'buy','cash','Synthetic supplier',l,null);
 if not exists(select 1 from public.recycling_transactions where id=(normal->>'id')::uuid and document_at is null) then raise exception 'AUTO_DATE_CHANGED'; end if;
 if not exists(select 1 from public.recycling_stock_balances where tenant_id=t and branch_id=b and product_id=p and quantity_base=4 and carrying_cost_minor=30200) then raise exception 'DATE_STOCK_DUPLICATED'; end if;
 if has_function_privilege('authenticated','public.recycling_post_transaction_with_document_time(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,timestamptz)','execute') then raise exception 'DATE_RPC_EXPOSED'; end if;
 raise notice 'PASS: document date distinct from actual posting, automatic mode unchanged, no duplicate stock on retry';
end;
$uat$;
rollback;
