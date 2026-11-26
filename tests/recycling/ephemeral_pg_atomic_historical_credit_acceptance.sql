-- Synthetic, rolls back all writes. No actual tax documents.
begin;
insert into public.users_profiles(id,is_active)
 values('dededede-dede-4ede-8ede-dededededede',true);
insert into public.user_branch_roles(user_id,tenant_id,branch_id,role)
 values('dededede-dede-4ede-8ede-dededededede',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222','manager');
insert into public.finance_accounting_chart(
  tenant_id,account_code,account_name,account_type,created_by)
values('11111111-1111-4111-8111-111111111111','2200','ภาษีขายรอนำส่ง','liability',
       '44444444-4444-4444-8444-444444444444');
insert into public.tenant_tax_settings(tenant_id,branch_id,is_enabled,settings)
values('11111111-1111-4111-8111-111111111111',
       '22222222-2222-4222-8222-222222222222',true,
       '{"lines":[{"id":"vat-7","label":"VAT 7%","rate_pct":7,"mode":"add_to_bill","is_active":true}]}'::jsonb);
insert into public.recycling_vat_issuers(
  tenant_id,branch_id,tax_id,legal_name,legal_address,branch_no,
  evidence_reference,verified_by,verified_at,verified_from,active)
values('11111111-1111-4111-8111-111111111111',
       '22222222-2222-4222-8222-222222222222',
       '0105555555555','Synthetic VAT registered recycler',
       '1 Example Road, Fake Province','00000',
       'SYNTHETIC-UAT-DOCUMENT-DO-NOT-USE',
       'dededede-dede-4ede-8ede-dededededede',now(),
       (now() at time zone 'Asia/Bangkok')::date-interval '1 day',true);
insert into public.pos_tax_invoice_profiles(
  id,tenant_id,branch_id,entity_type,display_name,tax_id,address_line,
  subdistrict,district,province,postal_code)
values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '11111111-1111-4111-8111-111111111111',
       '22222222-2222-4222-8222-222222222222',
       'company','Synthetic buyer','0105555555555','2 Example Road',
       'Example Subdistrict','Example District','Example Province','10000');
insert into public.shifts(id,tenant_id,branch_id,opening_cash,status,metadata)
values('85858585-8585-4858-8858-858585858585',
       '11111111-1111-4111-8111-111111111111',
       '22222222-2222-4222-8222-222222222222',
       1000,'open','{"business_shift_mode":"recycling_daily"}'::jsonb);

insert into public.products(id,tenant_id,branch_id,sku,name,category,price,sell_unit,metadata)
values('d4000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','SYNTHETIC-REPLAY','Synthetic material','UAT',20,'kg','{"business_mode":"recycling","recycling_price_basis":"kg","recycling_buy_price":10}');

insert into public.products(id,tenant_id,branch_id,sku,name,category,price,sell_unit,metadata)
select id::uuid,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',sku,'Synthetic material','UAT',20,'kg','{"business_mode":"recycling","recycling_price_basis":"kg","recycling_buy_price":10}'
from (values ('d5000000-0000-4000-8000-000000000001','SYN-CREDIT'),('d5000000-0000-4000-8000-000000000002','SYN-DEBIT')) v(id,sku);
do $uat$
declare
 t uuid:='11111111-1111-4111-8111-111111111111'; b uuid:='22222222-2222-4222-8222-222222222222';
 u uuid:='33333333-3333-4333-8333-333333333333'; a uuid:='44444444-4444-4444-8444-444444444444';
 m uuid:='dededede-dede-4ede-8ede-dededededede'; s uuid:='85858585-8585-4858-8858-858585858585';
 buyer uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; p uuid:='d4000000-0000-4000-8000-000000000001';
 p2 uuid:='d5000000-0000-4000-8000-000000000001'; p3 uuid:='d5000000-0000-4000-8000-000000000002';
 day date:=(now() at time zone 'Asia/Bangkok')::date;
 r uuid:=gen_random_uuid(); buy uuid; sale uuid; invoice uuid; result jsonb; retry jsonb; n bigint;
begin
 insert into public.finance_accounting_periods(tenant_id,branch_id,period_month) values(t,b,date_trunc('month',day)::date) on conflict do nothing;
 buy:=(public.recycling_post_transaction_vat(t,b,s,u,gen_random_uuid(),'buy','credit','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','kg','quantity',10,'expected_price',10)))->>'id')::uuid;
 sale:=(public.recycling_post_transaction_vat(t,b,s,u,gen_random_uuid(),'sell','credit','Synthetic buyer',jsonb_build_array(jsonb_build_object('product_id',p,'unit','kg','quantity',4,'expected_price',20)))->>'id')::uuid;
 perform public.recycling_finance_post_transaction(t,b,buy,a);
 -- Force a failure after reversal and replacement GL writes: later sale not posted yet.
 select count(*) into n from public.finance_accounting_journals;
 begin
  perform public.recycling_apply_historical_credit_correction(t,b,buy,m,r,10000,8,15,'Synthetic purchase quantity correction','UAT proof only',true);
  raise exception 'ATOMIC_LATER_GL_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_historical_later_gl_required%' then raise; end if; end;
 if (select count(*) from public.finance_accounting_journals)<>n or exists(select 1 from public.recycling_gl_reversals where request_id=r) or not exists(select 1 from public.recycling_stock_balances where tenant_id=t and branch_id=b and product_id=p and quantity_base=6 and carrying_cost_minor=6000) then raise exception 'ATOMIC_ROLLBACK_FAILED'; end if;
 perform public.recycling_finance_post_transaction(t,b,sale,a);
 result:=public.recycling_apply_historical_credit_correction(t,b,buy,m,r,10000,8,15,'Synthetic purchase quantity correction','UAT proof only',true);
 if (result->>'new_total_minor')::bigint<>12000 or (result->'later_journals'->0->>'delta_minor')::bigint<>2000 then raise exception 'ATOMIC_REPLAY_WRONG: %',result; end if;
 if not exists(select 1 from public.recycling_stock_balances where tenant_id=t and branch_id=b and product_id=p and quantity_base=4 and carrying_cost_minor=6000) then raise exception 'ATOMIC_STOCK_WRONG'; end if;
 if not exists(select 1 from public.recycling_effective_historical_amounts where id=buy and total_minor=12000) or not exists(select 1 from public.recycling_effective_historical_amounts where id=sale and cogs_minor=6000) then raise exception 'ATOMIC_EFFECTIVE_TOTALS_WRONG'; end if;
 retry:=public.recycling_apply_historical_credit_correction(t,b,buy,m,r,10000,8,15,'Synthetic purchase quantity correction','UAT proof only',true);
 if retry->>'idempotent'<>'true' or retry->>'corrected_journal_id'<>result->>'corrected_journal_id' then raise exception 'ATOMIC_RETRY_WRONG'; end if;
 -- Two independent VAT documents: one credit note, one debit note.
 foreach p in array array[p2,p3] loop
  buy:=(public.recycling_post_transaction_vat(t,b,s,u,gen_random_uuid(),'buy','credit','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','kg','quantity',10,'expected_price',10)))->>'id')::uuid;
  sale:=(public.recycling_post_transaction_vat(t,b,s,u,gen_random_uuid(),'sell','credit','Synthetic buyer',jsonb_build_array(jsonb_build_object('product_id',p,'unit','kg','quantity',4,'expected_price',20)))->>'id')::uuid;
  invoice:=(public.recycling_issue_tax_invoice(t,b,sale,buyer,m,'00000')->>'id')::uuid;
  perform public.recycling_finance_post_transaction(t,b,sale,a);
  result:=public.recycling_apply_historical_credit_correction(t,b,sale,m,gen_random_uuid(),8560,4,case when p=p2 then 15 else 25 end,'Synthetic invoiced price correction','UAT evidence only',true);
  if not exists(select 1 from public.recycling_tax_adjustment_notes where id=(result->>'tax_note_id')::uuid and invoice_id=invoice and kind=case when p=p2 then 'credit_note' else 'debit_note' end and (amount_snapshot->>'vat_delta_minor')::bigint=case when p=p2 then -140 else 140 end) then raise exception 'ATOMIC_NOTE_WRONG: %',result; end if;
  if not exists(select 1 from public.recycling_tax_invoices where id=invoice and (tax_snapshot->>'vat_minor')::bigint=560) then raise exception 'ATOMIC_ORIGINAL_INVOICE_CHANGED'; end if;
 end loop;
 if (select count(*) from public.recycling_tax_adjustment_notes where tenant_id=t)<>2 then raise exception 'ATOMIC_NOTE_COUNT_WRONG'; end if;
 if exists(select 1 from public.finance_accounting_journals j where j.event_type in ('recycling_reversal','recycling_corrected','recycling_cogs_adjustment') and (j.debit_total_minor<>(select sum(debit_minor) from public.finance_accounting_journal_lines where journal_id=j.id) or j.credit_total_minor<>(select sum(credit_minor) from public.finance_accounting_journal_lines where journal_id=j.id))) then raise exception 'ATOMIC_GL_UNBALANCED'; end if;
 raise notice 'PASS: numbered VAT notes, historical stock, reversal plus replacement GL and subsequent COGS, atomic rollback and retry';
end;
$uat$;
rollback;
