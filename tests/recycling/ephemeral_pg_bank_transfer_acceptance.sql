-- Synthetic PostgreSQL only. All data changes roll back.
begin;
insert into public.shifts(id,tenant_id,branch_id,opening_cash,status,opened_at,metadata)
values('b1000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',0,'open',now()-interval '1 minute','{"business_shift_mode":"recycling_daily"}');
insert into public.products(id,tenant_id,branch_id,sku,name,category,price,sell_unit,metadata)
values('b1000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','SYNTHETIC-BANK','Synthetic material','UAT',100.00,'kg','{"business_mode":"recycling","recycling_price_basis":"kg","recycling_buy_price":50.25}');
insert into public.recycling_bank_accounts(id,tenant_id,branch_id,bank_code,account_last4,account_label,evidence_reference,verified_by,verified_at,active)
values('b1000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','TEST','1234','Synthetic account','SYNTHETIC-OWNERSHIP-REFERENCE','44444444-4444-4444-8444-444444444444',now(),true);
insert into public.finance_accounting_chart(tenant_id,account_code,account_name,account_type,created_by)
values('11111111-1111-4111-8111-111111111111','2200','Synthetic VAT liability','liability','44444444-4444-4444-8444-444444444444') on conflict do nothing;
insert into public.tenant_tax_settings(tenant_id,branch_id,is_enabled,settings)
values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',true,'{"lines":[{"label":"VAT 7%","rate_pct":7,"mode":"add_to_bill","is_active":true}]}');
insert into public.recycling_vat_issuers(tenant_id,branch_id,tax_id,legal_name,legal_address,branch_no,evidence_reference,verified_by,verified_at,verified_from,active)
values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','0105555555555','Synthetic VAT seller','Synthetic address','00000','SYNTHETIC-VAT-EVIDENCE','44444444-4444-4444-8444-444444444444',now(),(now() at time zone 'Asia/Bangkok')::date,true);
do $uat$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
 u uuid:='33333333-3333-4333-8333-333333333333';
 a uuid:='44444444-4444-4444-8444-444444444444';
 s uuid:='b1000000-0000-4000-8000-000000000001';
 p uuid:='b1000000-0000-4000-8000-000000000002';
 bank uuid:='b1000000-0000-4000-8000-000000000003';
 buy_id uuid:='b1000000-0000-4000-8000-000000000004';
 sell_id uuid:='b1000000-0000-4000-8000-000000000005';
 wrong_id uuid:='b1000000-0000-4000-8000-000000000006';
 buy_lines jsonb:=jsonb_build_array(jsonb_build_object('product_id',p,'quantity',2,'unit','kg','expected_price',50.25));
 sale_lines jsonb:=jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1,'unit','kg','expected_price',100));
 buy jsonb; sale jsonb; replay jsonb; evidence uuid;
begin
 begin
  perform public.recycling_post_transaction_verified_bank(t,b,s,u,buy_id,'buy','bank_transfer','Supplier',buy_lines);
  raise exception 'BANK_UNVERIFIED_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_bank_transfer_verification_required%' then raise; end if; end;
 begin
  perform public.recycling_record_bank_transfer_evidence(t,b,s,u,buy_id,'buy','Supplier',buy_lines,bank,'TEST-BUY-001',10050,now(),'TEST-STATEMENT',u);
  raise exception 'BANK_SELF_APPROVAL_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_bank_evidence_invalid%' then raise; end if; end;
 evidence:=public.recycling_record_bank_transfer_evidence(t,b,s,u,buy_id,'buy','Supplier',buy_lines,bank,'TEST-BUY-001',10050,now(),'TEST-STATEMENT',a);
 buy:=public.recycling_post_transaction_verified_bank(t,b,s,u,buy_id,'buy','bank_transfer','Supplier',buy_lines);
 if (buy->>'total_minor')::bigint<>10050 or not exists(select 1 from public.recycling_bank_transfer_evidence where id=evidence and consumed_transaction_id=(buy->>'id')::uuid) then raise exception 'BANK_BUY_NOT_CONSUMED'; end if;
 if not exists(select 1 from public.recycling_accounting_entries where transaction_id=(buy->>'id')::uuid and account_code='1110' and credit_minor=10050) then raise exception 'BANK_BUY_LEDGER'; end if;
 replay:=public.recycling_post_transaction_verified_bank(t,b,s,u,buy_id,'buy','bank_transfer','Supplier',buy_lines);
 if replay->>'id'<>buy->>'id' or replay->>'idempotent'<>'true' then raise exception 'BANK_REPLAY'; end if;
 begin
  perform public.recycling_record_bank_transfer_evidence(t,b,s,u,sell_id,'sell','Buyer',sale_lines,bank,'TEST-BUY-001',10700,now(),'TEST-STATEMENT',a);
  raise exception 'BANK_DUPLICATE_REFERENCE_ACCEPTED';
 exception when unique_violation then null; end;
 evidence:=public.recycling_record_bank_transfer_evidence(t,b,s,u,wrong_id,'sell','Buyer',sale_lines,bank,'TEST-WRONG-001',10699,now(),'TEST-STATEMENT',a);
 begin
  perform public.recycling_post_transaction_verified_bank(t,b,s,u,wrong_id,'sell','bank_transfer','Buyer',sale_lines);
  raise exception 'BANK_WRONG_AMOUNT_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_bank_amount_mismatch%' then raise; end if; end;
 if exists(select 1 from public.recycling_transactions where request_id=wrong_id) or not exists(select 1 from public.recycling_bank_transfer_evidence where id=evidence and consumed_transaction_id is null) or not exists(select 1 from public.recycling_stock_balances where product_id=p and quantity_base=2) then raise exception 'BANK_ROLLBACK'; end if;
 evidence:=public.recycling_record_bank_transfer_evidence(t,b,s,u,sell_id,'sell','Buyer',sale_lines,bank,'TEST-SELL-001',10700,now(),'TEST-STATEMENT',a);
 sale:=public.recycling_post_transaction_verified_bank(t,b,s,u,sell_id,'sell','bank_transfer','Buyer',sale_lines);
 if (sale->>'total_minor')::bigint<>10700 or (sale->>'vat_minor')::bigint<>700 then raise exception 'BANK_VAT_GROSS'; end if;
 if not exists(select 1 from public.recycling_accounting_entries where transaction_id=(sale->>'id')::uuid and account_code='1110' and debit_minor=10700) or exists(select 1 from public.recycling_accounting_entries where transaction_id in ((buy->>'id')::uuid,(sale->>'id')::uuid) and account_code='1100') then raise exception 'BANK_NOT_CASH'; end if;
 if exists(select transaction_id from public.recycling_accounting_entries where transaction_id in ((buy->>'id')::uuid,(sale->>'id')::uuid) group by transaction_id having sum(debit_minor-credit_minor)<>0) then raise exception 'BANK_GL_UNBALANCED'; end if;
 raise notice 'PASS: verified buy, VAT sale, exact satang, idempotency, duplicate reference, rollback and no drawer movement';
end;
$uat$;
rollback;
