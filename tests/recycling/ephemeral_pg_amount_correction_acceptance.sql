-- Synthetic UAT only. No production data.
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
values('d3000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','SYNTHETIC-AMOUNT','Synthetic material','UAT',100.25,'piece','{"business_mode":"recycling","recycling_price_basis":"piece","recycling_price_unit":"piece","recycling_buy_price":75.50}');
do $uat$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
 u uuid:='33333333-3333-4333-8333-333333333333';
 a uuid:='44444444-4444-4444-8444-444444444444';
 m uuid:='dededede-dede-4ede-8ede-dededededede';
 s uuid:='85858585-8585-4858-8858-858585858585';
 p uuid:='d3000000-0000-4000-8000-000000000001';
 buyer uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 r uuid:=gen_random_uuid();
 old_id uuid; new_id uuid; sale_id uuid; final_id uuid; d timestamptz;
 old_total bigint; new_total bigint;
 result jsonb; retry jsonb;
 l jsonb;
begin
 result:=public.recycling_post_transaction_with_document_time(t,b,s,u,gen_random_uuid(),'buy','cash','Synthetic supplier',
  jsonb_build_array(jsonb_build_object('product_id',p,'unit','piece','quantity',2,'expected_price',75.50)),now()-interval '1 day');
 old_id:=(result->>'id')::uuid;
 select effective_document_at,total_minor into strict d,old_total from public.recycling_transactions where id=old_id;
 l:=jsonb_build_array(jsonb_build_object('product_id',p,'unit','piece','quantity',3,'expected_price',75.50));
 begin
  perform public.recycling_replace_eligible_bill(t,b,old_id,u,gen_random_uuid(),d,old_total,l,'Staff cannot alter receipt','pos',true,true);
  raise exception 'AMOUNT_STAFF_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_amount_correction_forbidden%' then raise; end if; end;
 begin
  perform public.recycling_replace_eligible_bill(t,b,old_id,m,gen_random_uuid(),d,old_total,jsonb_build_array(jsonb_build_object('product_id',p,'unit','piece','quantity',3,'expected_price',1.00)),'Invalid price must roll back','pos',true,true);
  raise exception 'AMOUNT_BAD_PRICE_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_price_changed_refresh_cart%' then raise; end if; end;
 if not exists(select 1 from public.recycling_transactions where id=old_id and status='posted') or
    not exists(select 1 from public.recycling_stock_balances where tenant_id=t and branch_id=b and product_id=p and quantity_base=2 and carrying_cost_minor=15100)
 then raise exception 'AMOUNT_ROLLBACK_FAILED'; end if;
 result:=public.recycling_replace_eligible_bill(t,b,old_id,m,r,d,old_total,l,'Manager corrects purchase quantity','pos',true,true);
 new_id:=(result->>'replacement_id')::uuid;
 if (result->>'new_total_minor')::bigint<>22650 or (result->>'old_total_minor')::bigint<>15100 then raise exception 'AMOUNT_TOTAL_FAILED'; end if;
 if not exists(select 1 from public.recycling_transactions where id=old_id and status='voided') or not exists(select 1 from public.recycling_transactions where id=new_id and status='posted' and effective_document_at=d)
 then raise exception 'AMOUNT_LINK_OR_DATE_FAILED'; end if;
 if not exists(select 1 from public.recycling_stock_balances where tenant_id=t and branch_id=b and product_id=p and quantity_base=3 and carrying_cost_minor=22650)
 then raise exception 'AMOUNT_STOCK_FAILED'; end if;
 if (select sum((x->>'net_debit_minor')::bigint) from jsonb_array_elements(result->'subledger_delta') x)<>0 then raise exception 'AMOUNT_LEDGER_DELTA_UNBALANCED'; end if;
 retry:=public.recycling_replace_eligible_bill(t,b,old_id,m,r,d,old_total,l,'Manager corrects purchase quantity','pos',true,true);
 if retry->>'replacement_id'<>new_id::text or retry->>'idempotent'<>'true' then raise exception 'AMOUNT_RETRY_FAILED'; end if;
 result:=public.recycling_post_transaction_vat(t,b,s,u,gen_random_uuid(),'sell','cash','Synthetic buyer',
  jsonb_build_array(jsonb_build_object('product_id',p,'unit','piece','quantity',1,'expected_price',100.25)));
 sale_id:=(result->>'id')::uuid;
 select effective_document_at,total_minor into strict d,old_total from public.recycling_transactions where id=sale_id;
 l:=jsonb_build_array(jsonb_build_object('product_id',p,'unit','piece','quantity',2,'expected_price',100.25));
 result:=public.recycling_replace_eligible_bill(t,b,sale_id,a,gen_random_uuid(),d,old_total,l,'Accountant corrects unissued VAT sale','finance',true,true);
 final_id:=(result->>'replacement_id')::uuid;
 if (result->>'new_total_minor')::bigint<>21454 or (result->>'vat_delta_minor')::bigint<>702 then raise exception 'AMOUNT_VAT_FAILED: %',result; end if;
 if not exists(select 1 from public.recycling_stock_balances where tenant_id=t and branch_id=b and product_id=p and quantity_base=1 and carrying_cost_minor=7550)
 then raise exception 'AMOUNT_SALE_STOCK_FAILED'; end if;
 if not exists(select 1 from public.recycling_accounting_entries where transaction_id=final_id and account_code='2200' and credit_minor=1404) then raise exception 'AMOUNT_VAT_LEDGER_FAILED'; end if;
 if (select sum((x->>'net_debit_minor')::bigint) from jsonb_array_elements(result->'subledger_delta') x)<>0 then raise exception 'AMOUNT_VAT_LEDGER_UNBALANCED'; end if;
 select effective_document_at,total_minor into strict d,new_total from public.recycling_transactions where id=final_id;
 perform public.recycling_issue_tax_invoice(t,b,final_id,buyer,m,'00000');
 begin
  perform public.recycling_replace_eligible_bill(t,b,final_id,m,gen_random_uuid(),d,new_total,l,'Issued tax invoice must remain unchanged','pos',true,true);
  raise exception 'AMOUNT_ISSUED_VAT_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_amount_correction_tax_note_required%' then raise; end if; end;
 -- Posting a replacement into GL uses the effective document date, not actual entry time.
 result:=public.recycling_finance_post_transaction(t,b,new_id,a);
 if not exists(select 1 from public.finance_accounting_documents doc join public.finance_accounting_journals j on j.id=doc.posted_journal_id
  join public.recycling_transactions tx on tx.finance_document_id=doc.id
  where tx.id=new_id and doc.document_date=(tx.effective_document_at at time zone 'Asia/Bangkok')::date
  and j.accounting_date=doc.document_date and j.debit_total_minor=j.credit_total_minor and j.debit_total_minor=22650)
 then raise exception 'AMOUNT_GL_DOCUMENT_DATE_FAILED'; end if;
 select effective_document_at,total_minor into strict d,new_total from public.recycling_transactions where id=new_id;
 begin
  perform public.recycling_replace_eligible_bill(t,b,new_id,m,gen_random_uuid(),d,new_total,l,'Posted GL requires separate reversal','pos',true,true);
  raise exception 'AMOUNT_POSTED_GL_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_amount_correction_gl_reversal_required%' then raise; end if; end;
 if has_function_privilege('authenticated','public.recycling_replace_eligible_bill(uuid,uuid,uuid,uuid,uuid,timestamptz,bigint,jsonb,text,text,boolean,boolean)','execute') then raise exception 'AMOUNT_RPC_EXPOSED'; end if;
 raise notice 'PASS: atomic replacement, historical document date, stock/cost, VAT, balanced ledger delta, retry and rollback';
end;
$uat$;
rollback;
