-- Disposable PostgreSQL UAT. All IDs, shops, VAT numbers, items and money are fake.
-- Exercise an actual 7% VAT server posting, double entry, Finance and issuance.
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
do $uat$
declare
 t uuid:='11111111-1111-4111-8111-111111111111';
 b uuid:='22222222-2222-4222-8222-222222222222';
 u uuid:='33333333-3333-4333-8333-333333333333';
 a uuid:='44444444-4444-4444-8444-444444444444';
 manager_id uuid:='dededede-dede-4ede-8ede-dededededede';
 shift_id uuid:='85858585-8585-4858-8858-858585858585';
 product uuid:='55555555-5555-4555-8555-555555555555';
 buyer uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 buy jsonb;
 sale jsonb;
 repeat_sale jsonb;
 invoice jsonb;
 repeated_invoice jsonb;
 finance jsonb;
 tx_id uuid;
 n bigint;
 old_count integer;
begin
 select count(*) into old_count from public.recycling_transactions where base_minor is null;
 if old_count<1 then raise exception 'UAT_VAT_LEGACY_RECEIPTS_MISSING'; end if;
 select public.recycling_post_transaction_vat(
  t,b,shift_id,u,'87878787-8787-4878-8878-878787878787',
  'buy','cash','Synthetic supplier',
  jsonb_build_array(jsonb_build_object('product_id',product,
    'quantity',10,'unit','kg','expected_price',3.55))
 ) into buy;
 -- Earlier receipt regression changes supplier buy price to 3.55.
 if (buy->>'vat_minor')::bigint<>0 or (buy->>'base_minor')::bigint<>3550 then
   raise exception 'UAT_VAT_PURCHASE_MUST_NOT_GAIN_INPUT_VAT: %',buy;
 end if;
 select public.recycling_post_transaction_vat(
  t,b,shift_id,u,'88888888-7878-4787-8787-888888888888',
  'sell','cash','Synthetic VAT buyer',
  jsonb_build_array(jsonb_build_object('product_id',product,
    'quantity',10,'unit','kg','expected_price',10))
 ) into sale;
 tx_id:=(sale->>'id')::uuid;
 if (sale->>'base_minor')::bigint<>10000
    or (sale->>'vat_minor')::bigint<>700
    or (sale->>'total_minor')::bigint<>10700
    or (sale->>'tax_state')<>'vat_recorded' then
    raise exception 'UAT_VAT_100_PLUS_7_NOT_107: %',sale;
 end if;
 if (select sum(debit_minor-credit_minor) from public.recycling_accounting_entries
    where transaction_id=tx_id)<>0 then
    raise exception 'UAT_VAT_DOUBLE_ENTRY_NOT_BALANCED';
 end if;
 if (select credit_minor from public.recycling_accounting_entries
    where transaction_id=tx_id and account_code='2200')<>700 then
    raise exception 'UAT_VAT_OUTPUT_TAX_LIABILITY_NOT_700';
 end if;
 if (select credit_minor from public.recycling_accounting_entries
    where transaction_id=tx_id and account_code='4100')<>10000 then
    raise exception 'UAT_VAT_REVENUE_MUST_BE_BASE';
 end if;
 if (select debit_minor from public.recycling_accounting_entries
    where transaction_id=tx_id and account_code='1100')<>10700 then
    raise exception 'UAT_VAT_CASH_MUST_BE_GROSS';
 end if;
 select public.recycling_post_transaction_vat(
  t,b,shift_id,u,'88888888-7878-4787-8787-888888888888',
  'sell','cash','Synthetic VAT buyer',
  jsonb_build_array(jsonb_build_object('product_id',product,
    'quantity',10,'unit','kg','expected_price',10))
 ) into repeat_sale;
 if repeat_sale->>'id'<>sale->>'id' or repeat_sale->>'idempotent'<>'true'
    or (repeat_sale->>'vat_minor')::bigint<>700 then
    raise exception 'UAT_VAT_IDEMPOTENT_REPLAY_FAILED: %',repeat_sale;
 end if;
 select public.recycling_issue_tax_invoice(t,b,tx_id,buyer,manager_id) into invoice;
 select public.recycling_issue_tax_invoice(t,b,tx_id,buyer,manager_id) into repeated_invoice;
 if invoice->>'invoice_no'<>'RTI-000001'
    or (repeated_invoice->>'idempotent')<>'true'
    or repeated_invoice->>'id'<>invoice->>'id' then
    raise exception 'UAT_VAT_INVOICE_NUMBER_OR_IDEMPOTENCY_FAILED: %, %',invoice,repeated_invoice;
 end if;
 if (select (tax_snapshot->>'vat_minor')::bigint from public.recycling_tax_invoices
    where id=(invoice->>'id')::uuid)<>700 then
    raise exception 'UAT_VAT_INVOICE_SNAPSHOT_NOT_SEVEN';
 end if;
 begin
  update public.recycling_transactions set vat_minor=0 where id=tx_id;
  raise exception 'UAT_VAT_SNAPSHOT_UPDATE_SHOULD_HAVE_BEEN_BLOCKED';
 exception when others then
  if sqlerrm='UAT_VAT_SNAPSHOT_UPDATE_SHOULD_HAVE_BEEN_BLOCKED' then raise; end if;
 end;
 begin
  update public.recycling_transactions set status='voided' where id=tx_id;
  raise exception 'UAT_VAT_INVOICE_VOID_SHOULD_HAVE_BEEN_BLOCKED';
 exception when others then
  if sqlerrm='UAT_VAT_INVOICE_VOID_SHOULD_HAVE_BEEN_BLOCKED' then raise; end if;
 end;
 select public.recycling_finance_post_transaction(t,b,tx_id,a) into finance;
 if (finance->>'posted')<>'true'
  or (select tax_minor from public.finance_accounting_documents
      where id=(finance->>'document_id')::uuid)<>700 then
  raise exception 'UAT_VAT_FINANCE_TAX_NOT_POSTED: %',finance;
 end if;
 select count(*) into n from public.recycling_transactions where base_minor is null;
 if n<>old_count then raise exception 'UAT_VAT_LEGACY_BACKFILLED'; end if;
 raise notice 'PASS: server VAT 100.00+7.00=107.00, balanced GL, immutable invoice and legacy isolation';
end;
$uat$;
rollback;
