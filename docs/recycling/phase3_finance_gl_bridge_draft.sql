-- REVIEW ONLY — apply only on an explicitly approved isolated staging DB.
-- Prerequisite: phase2_transaction_schema_draft.sql and existing Finance schema.
-- Post a verified Recycling subledger into Finance GL only after an accountant
-- independently authorizes the cashier's original transaction.
--
-- IMPORTANT: Not a substitute for VAT verification, payment settlement,
-- legally numbered invoices, reversals or period-closing UAT.
-- The existing finance_accounting_post_document rejects inventory purchases
-- (it requires supplier_bill expense/liability). This purpose-built bridge
-- posts Inventory/AP or Inventory/Cash and Sales/AR + COGS/Inventory without
-- relaxing existing Finance document constraints or standard posting logic.

create or replace function public.recycling_finance_post_transaction(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_transaction_id uuid,
  p_accountant_user_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_tx public.recycling_transactions%rowtype;
  v_doc uuid;
  v_journal uuid;
  v_account record;
  v_entry record;
  v_line record;
  v_expected_type text;
  v_debits bigint;
  v_credits bigint;
  v_amount bigint;
  v_document_no text;
  v_document_kind text;
  v_document_date date;
  v_payment_method text;
  v_status text;
  v_line_count int;
  v_num int := 0;
begin
  -- Existing Finance privilege check requires the active accountant role
  -- in precisely this tenant and branch, enforced on the database side.
  perform public.finance_accounting_check_actor(
    p_tenant_id,p_branch_id,p_accountant_user_id
  );
  if p_transaction_id is null then
    raise exception 'recycling_finance_transaction_id_required';
  end if;
  select * into v_tx from public.recycling_transactions
   where id=p_transaction_id and tenant_id=p_tenant_id
     and branch_id=p_branch_id for update;
  if not found or v_tx.status <> 'posted' then
    raise exception 'recycling_finance_transaction_not_found';
  end if;
  if v_tx.operator_user_id=p_accountant_user_id then
    raise exception 'recycling_finance_self_approval_forbidden';
  end if;
  if v_tx.finance_document_id is not null then
    select posted_journal_id into v_journal
      from public.finance_accounting_documents
      where id=v_tx.finance_document_id
        and tenant_id=p_tenant_id and branch_id=p_branch_id;
    if not found or v_journal is null then
      raise exception 'recycling_finance_partial_posting_detected';
    end if;
    return jsonb_build_object(
      'document_id',v_tx.finance_document_id,'journal_id',v_journal,
      'posted',false,'idempotent',true);
  end if;

  v_document_date := (v_tx.created_at at time zone 'Asia/Bangkok')::date;
  if exists (
    select 1 from public.finance_accounting_periods
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and period_month=pg_catalog.date_trunc('month',v_document_date)::date
      and locked_at is not null
  ) then raise exception 'recycling_finance_period_locked'; end if;

  if v_tx.total_minor<=0 then raise exception 'recycling_finance_invalid_total'; end if;
  select count(*),coalesce(sum(debit_minor),0),coalesce(sum(credit_minor),0)
    into v_line_count,v_debits,v_credits
    from public.recycling_accounting_entries
   where transaction_id=v_tx.id and tenant_id=p_tenant_id and branch_id=p_branch_id;
  if v_line_count<2 or v_line_count>4 or v_debits<=0 or v_debits<>v_credits
    then raise exception 'recycling_finance_unbalanced_subledger'; end if;
  if v_debits <> v_tx.total_minor +
       case when v_tx.direction='sell' then v_tx.cogs_minor else 0 end
    then raise exception 'recycling_finance_subledger_total_mismatch'; end if;

  select count(*),coalesce(sum(amount_minor),0)
    into v_line_count,v_amount
    from public.recycling_transaction_lines
   where transaction_id=v_tx.id and tenant_id=p_tenant_id and branch_id=p_branch_id;
  if v_line_count<1 or v_line_count>100 or v_amount <> v_tx.total_minor
    then raise exception 'recycling_finance_line_total_mismatch'; end if;

  -- The chart of accounts is controlled by Finance. Do not manufacture
  -- account codes or silently change an existing account's type/name.
  for v_entry in
    select account_code,debit_minor,credit_minor,line_no
    from public.recycling_accounting_entries
    where transaction_id=v_tx.id and tenant_id=p_tenant_id and branch_id=p_branch_id
    order by line_no
  loop
    v_expected_type := case v_entry.account_code
      when '1100' then 'asset' when '1110' then 'asset'
      when '1200' then 'asset' when '1201' then 'asset'
      when '2100' then 'liability' when '4100' then 'income'
      when '5100' then 'expense' else null end;
    if v_expected_type is null then
      raise exception 'recycling_finance_account_code_unknown';
    end if;
    select id,account_type into v_account
      from public.finance_accounting_chart
      where tenant_id=p_tenant_id and account_code=v_entry.account_code;
    if not found or v_account.account_type <> v_expected_type then
      raise exception 'recycling_finance_chart_account_missing_or_invalid: %',v_entry.account_code;
    end if;
  end loop;

  v_document_kind := case v_tx.direction
    when 'buy' then 'supplier_bill' else 'sales_invoice' end;
  v_document_no := 'RCY-'||
    case v_tx.direction when 'buy' then 'B' else 'S' end||'-'||
    pg_catalog.to_char(v_document_date,'YYYYMMDD')||'-'||
    pg_catalog.replace(v_tx.id::text,'-','');
  v_payment_method := case v_tx.settlement when 'bank_transfer'
    then 'transfer' when 'cash' then 'cash' else 'other' end;

  insert into public.finance_accounting_documents
    (tenant_id,branch_id,document_kind,document_no,payment_method,
     counterparty_name,document_date,currency,amount_minor,tax_minor,status,
     request_key,request_snapshot,prepared_by,approved_by,approved_at,issued_at)
  values
    (p_tenant_id,p_branch_id,v_document_kind,v_document_no,v_payment_method,
     v_tx.counterparty_name,v_document_date,'THB',v_tx.total_minor,0,'issued',
     v_tx.id,pg_catalog.jsonb_build_object(
       'source','recycling','recycling_transaction_id',v_tx.id,
       'direction',v_tx.direction,'settlement',v_tx.settlement,
       'cogs_minor',v_tx.cogs_minor,'approval_source','accountant_review',
       'not_tax_invoice',true
     ),v_tx.operator_user_id,p_accountant_user_id,now(),now())
  returning id into v_doc;

  -- Positive purchase/sale lines mirror source quantities and amounts.
  for v_line in
    select l.line_no,p.name,l.original_quantity,l.original_unit,
       l.price_per_base,l.amount_minor
    from public.recycling_transaction_lines l
      join public.products p on p.id=l.product_id
    where l.transaction_id=v_tx.id
      and l.tenant_id=p_tenant_id and l.branch_id=p_branch_id
    order by l.line_no
  loop
    insert into public.finance_accounting_document_lines
      (tenant_id,branch_id,document_id,line_no,description,quantity,unit_minor,line_minor)
    values
      (p_tenant_id,p_branch_id,v_doc,v_line.line_no,
       pg_catalog.left(v_line.name||' ('||v_line.original_unit||')',500),
       v_line.original_quantity,pg_catalog.round(v_line.price_per_base*100)::bigint,
       v_line.amount_minor);
  end loop;

  insert into public.finance_accounting_journals
    (tenant_id,branch_id,document_id,posting_key,event_type,currency,
     accounting_date,debit_total_minor,credit_total_minor,posted_by)
  values
    (p_tenant_id,p_branch_id,v_doc,
     p_tenant_id::text||'/'||p_branch_id::text||'/recycling/'||
       v_tx.id::text||'/accountant_approved',
     'document_issued','THB',v_document_date,v_debits,v_credits,p_accountant_user_id)
  returning id into v_journal;

  for v_entry in
    select account_code,debit_minor,credit_minor,line_no
    from public.recycling_accounting_entries
    where transaction_id=v_tx.id and tenant_id=p_tenant_id and branch_id=p_branch_id
    order by line_no
  loop
    select id into v_account from public.finance_accounting_chart
    where tenant_id=p_tenant_id and account_code=v_entry.account_code;
    insert into public.finance_accounting_journal_lines
      (tenant_id,branch_id,journal_id,line_no,account_id,currency,debit_minor,credit_minor)
    values
      (p_tenant_id,p_branch_id,v_journal,v_entry.line_no,
       v_account.id,'THB',v_entry.debit_minor,v_entry.credit_minor);
  end loop;

  -- Immutable event trail: event actor is the accountant executing this
  -- source-to-GL approval; cashier remains the document preparer.
  insert into public.finance_accounting_document_events
    (tenant_id,branch_id,document_id,action,old_status,new_status,actor_user_id,event_payload)
  values
    (p_tenant_id,p_branch_id,v_doc,'created',null,'draft',p_accountant_user_id,
      pg_catalog.jsonb_build_object('source_transaction',v_tx.id)),
    (p_tenant_id,p_branch_id,v_doc,'submitted','draft','submitted',p_accountant_user_id,'{}'::jsonb),
    (p_tenant_id,p_branch_id,v_doc,'approved','submitted','approved',p_accountant_user_id,
      pg_catalog.jsonb_build_object('prepared_by',v_tx.operator_user_id)),
    (p_tenant_id,p_branch_id,v_doc,'issued','approved','issued',p_accountant_user_id,'{}'::jsonb),
    (p_tenant_id,p_branch_id,v_doc,'posted','issued','issued',p_accountant_user_id,
      pg_catalog.jsonb_build_object('journal_id',v_journal));

  update public.finance_accounting_documents set
    posted_journal_id=v_journal,version=2,updated_at=now()
    where id=v_doc and tenant_id=p_tenant_id and branch_id=p_branch_id;
  update public.recycling_transactions set finance_document_id=v_doc
    where id=v_tx.id and tenant_id=p_tenant_id and branch_id=p_branch_id;

  return jsonb_build_object(
    'document_id',v_doc,'journal_id',v_journal,'posted',true,'idempotent',false);
end;
$fn$;

revoke all on function public.recycling_finance_post_transaction(uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.recycling_finance_post_transaction(uuid,uuid,uuid,uuid)
  to service_role;

-- NOTE: Before staging release, generate a canonical migration, test this RPC
-- with cashier!=accountant, a locked period and every account_type mismatch.
-- This draft must be disabled when the store is VAT-registered unless the
-- merchant's verified VAT workflow is implemented.
