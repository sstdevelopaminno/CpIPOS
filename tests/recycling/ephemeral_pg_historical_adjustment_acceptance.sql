-- Synthetic historical adjustments only.
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
do $uat$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
 u uuid:='33333333-3333-4333-8333-333333333333';
 a uuid:='44444444-4444-4444-8444-444444444444';
 m uuid:='dededede-dede-4ede-8ede-dededededede';
 s uuid:='85858585-8585-4858-8858-858585858585';
 p uuid:='d4000000-0000-4000-8000-000000000001';
 buyer uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 day date:=(now() at time zone 'Asia/Bangkok')::date;
 req uuid:=gen_random_uuid();
 buy jsonb; sale jsonb; invoice jsonb; posted jsonb; preview jsonb; rev jsonb; retry jsonb;
 sale_id uuid; line_id uuid; original_j uuid; reverse_j uuid;
begin
 buy:=public.recycling_post_transaction_vat(t,b,s,u,gen_random_uuid(),'buy','cash','Synthetic supplier',jsonb_build_array(jsonb_build_object('product_id',p,'unit','kg','quantity',10,'expected_price',10)));
 sale:=public.recycling_post_transaction_vat(t,b,s,u,gen_random_uuid(),'sell','cash','Synthetic buyer',jsonb_build_array(jsonb_build_object('product_id',p,'unit','kg','quantity',4,'expected_price',20)));
 sale_id:=(sale->>'id')::uuid;
 select id into strict line_id from public.recycling_transaction_lines where transaction_id=(buy->>'id')::uuid;
 preview:=public.recycling_preview_stock_replay(t,b,m,p,line_id,8,12000);
 if (preview->>'old_qty')::numeric<>6 or (preview->>'new_qty')::numeric<>4 or (preview->>'old_cost_minor')::bigint<>6000 or (preview->>'new_cost_minor')::bigint<>6000 or (preview->'affected_sales'->0->>'cogs_delta_minor')::bigint<>2000 then raise exception 'HISTORICAL_REPLAY_WRONG: %',preview; end if;
 begin
 perform public.recycling_preview_stock_replay(t,b,m,p,line_id,3,3000);
 raise exception 'HISTORICAL_NEGATIVE_STOCK_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_replay_negative_stock%' then raise; end if; end;
 if not exists(select 1 from public.recycling_stock_balances where tenant_id=t and branch_id=b and product_id=p and quantity_base=6 and carrying_cost_minor=6000) then raise exception 'HISTORICAL_PREVIEW_MUTATED_STOCK'; end if;
 invoice:=public.recycling_issue_tax_invoice(t,b,sale_id,buyer,m,'00000');
 preview:=public.recycling_preview_issued_vat_adjustment(t,b,(invoice->>'id')::uuid,a,6000);
 if preview->>'type'<>'credit_note' or (preview->>'vat_delta_minor')::bigint<>-140 or (preview->>'gross_delta_minor')::bigint<>-2140 then raise exception 'HISTORICAL_CREDIT_NOTE_WRONG: %',preview; end if;
 preview:=public.recycling_preview_issued_vat_adjustment(t,b,(invoice->>'id')::uuid,a,10000);
 if preview->>'type'<>'debit_note' or (preview->>'vat_delta_minor')::bigint<>140 then raise exception 'HISTORICAL_DEBIT_NOTE_WRONG'; end if;
 if not exists(select 1 from public.recycling_tax_invoices where id=(invoice->>'id')::uuid and (tax_snapshot->>'vat_minor')::bigint=560) then raise exception 'HISTORICAL_INVOICE_MUTATED'; end if;
 posted:=public.recycling_finance_post_transaction(t,b,sale_id,a);
 original_j:=(posted->>'journal_id')::uuid;
 insert into public.finance_accounting_periods(tenant_id,branch_id,period_month,locked_at,locked_by) values(t,b,date_trunc('month',day)::date,now(),a)
 on conflict(tenant_id,branch_id,period_month) do update set locked_at=excluded.locked_at,locked_by=excluded.locked_by;
 begin
 perform public.recycling_stage_gl_reversal(t,b,sale_id,m,req,day,'Synthetic locked period reversal');
 raise exception 'HISTORICAL_LOCKED_PERIOD_ACCEPTED';
 exception when others then if sqlerrm not like '%recycling_gl_reversal_period_unavailable%' then raise; end if; end;
 update public.finance_accounting_periods set locked_at=null,locked_by=null where tenant_id=t and branch_id=b and period_month=date_trunc('month',day)::date;
 rev:=public.recycling_stage_gl_reversal(t,b,sale_id,m,req,day,'Synthetic posted GL reversal');
 reverse_j:=(rev->>'journal_id')::uuid;
 retry:=public.recycling_stage_gl_reversal(t,b,sale_id,m,req,day,'Synthetic posted GL reversal');
 if retry->>'journal_id'<>reverse_j::text or retry->>'idempotent'<>'true' then raise exception 'HISTORICAL_REVERSAL_RETRY'; end if;
 if exists(select 1 from (select * from public.finance_accounting_journal_lines where journal_id=original_j) o full join (select * from public.finance_accounting_journal_lines where journal_id=reverse_j) r on o.line_no=r.line_no where (o.account_id is distinct from r.account_id or o.debit_minor is distinct from r.credit_minor or o.credit_minor is distinct from r.debit_minor)) then
 raise exception 'HISTORICAL_REVERSAL_LINES_WRONG'; end if;
 if not exists(select 1 from public.finance_accounting_journals where id=original_j and event_type='document_issued') or not exists(select 1 from public.finance_accounting_journals where id=reverse_j and event_type='recycling_reversal' and debit_total_minor=credit_total_minor) then raise exception 'HISTORICAL_REVERSAL_WRONG'; end if;
 if has_function_privilege('service_role','public.recycling_stage_gl_reversal(uuid,uuid,uuid,uuid,uuid,date,text)','execute') then raise exception 'HISTORICAL_UNSAFE_STANDALONE_RPC'; end if;
 raise notice 'PASS: GL reversal, locked period, VAT draft deltas and replay of subsequent stock movement';
end;
$uat$;
rollback;
