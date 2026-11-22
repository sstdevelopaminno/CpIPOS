-- VAT posting is an ADDITIVE RPC. The original recycling_post_transaction
-- remains untouched for rollback. The API must choose this function explicitly
-- only after the reviewed VAT release feature flag is enabled.
-- SQL derived from the live 2026-11-22 RPC with its sequential RCY receipt allocator.
begin;
CREATE OR REPLACE FUNCTION public.recycling_post_transaction_vat(p_tenant_id uuid, p_branch_id uuid, p_shift_id uuid, p_user_id uuid, p_request_id uuid, p_direction text, p_settlement text, p_counterparty_name text, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_contract record;
  v_lifecycle record;
  v_id uuid;
  v_receipt_no text;
  v_existing record;
  v_request_hash text;
  v_line jsonb;
  v_p record;
  v_stock record;
  v_index integer;
  v_unit text;
  v_basis text;
  v_quantity numeric(18,6);
  v_base_quantity numeric(18,6);
  v_multiplier numeric(18,6);
  v_price numeric(16,2);
  v_line_minor bigint;
  v_cost_minor bigint;
  v_total_minor bigint := 0;
  v_cogs_minor bigint := 0;
  v_new_qty numeric(18,6);
  v_new_value bigint;
  v_cash_code text;
  v_cash_name text;
  v_opening_cash_minor bigint;
  v_cash_balance_minor bigint;
  v_base_minor bigint := 0;
  v_vat_minor bigint := 0;
  v_vat_rate numeric := 0;
  v_tax_state text := 'no_vat';
  v_tax_snapshot jsonb := '{}'::jsonb;
  v_settings record;
  v_vat_line jsonb;
  v_active_lines int := 0;
  v_issuer public.recycling_vat_issuers%rowtype;
begin
  if p_tenant_id is null or p_branch_id is null or p_shift_id is null or
     p_user_id is null or p_request_id is null then
    raise exception 'recycling_invalid_identity';
  end if;
  if coalesce(p_direction,'') not in ('buy','sell') or
     coalesce(p_settlement,'') not in ('cash','bank_transfer','credit') then
    raise exception 'recycling_invalid_direction_or_settlement';
  end if;
  -- Never assert that money has reached a bank account merely from a
  -- cashier-selected payment method. An independent transfer evidence
  -- and reconciliation workflow must be implemented before this method
  -- can create a paid bank asset in the Finance subledger.
  if p_settlement='bank_transfer' then
    raise exception 'recycling_bank_transfer_verification_required';
  end if;
  if length(btrim(coalesce(p_counterparty_name,''))) not between 1 and 240 then
    raise exception 'recycling_counterparty_required';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'recycling_lines_required';
  end if;
  if jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'recycling_lines_required';
  end if;

  -- Identical request IDs serialize, preventing duplicate settlement on retry.
  -- A reused idempotency key with a changed payload must never be accepted.
  v_request_hash := pg_catalog.md5(pg_catalog.jsonb_build_object(
    'shift_id',p_shift_id,'user_id',p_user_id,'direction',p_direction,
    'settlement',p_settlement,'counterparty',btrim(p_counterparty_name),
    'lines',p_lines
  )::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
    p_tenant_id::text || ':' || p_branch_id::text || ':' || p_request_id::text
  ));
  select id,receipt_no,total_minor,cogs_minor,request_hash,base_minor,vat_minor,tax_state into v_existing from public.recycling_transactions
    where tenant_id=p_tenant_id and branch_id=p_branch_id and request_id=p_request_id;
  if found then
    if v_existing.request_hash is distinct from v_request_hash then
      raise exception 'recycling_request_key_reused';
    end if;
    return jsonb_build_object('id',v_existing.id,'receipt_no',v_existing.receipt_no,
      'total_minor',v_existing.total_minor,'base_minor',v_existing.base_minor,'vat_minor',v_existing.vat_minor,'tax_state',v_existing.tax_state,'cogs_minor',v_existing.cogs_minor,'idempotent',true);
  end if;

  select c.status,c.ended_at,c.metadata,p.code as package_code
    into v_contract from public.tenant_subscription_contracts c
    join public.subscription_packages p on p.id=c.package_id
    where c.tenant_id=p_tenant_id order by c.created_at desc limit 1;
  if not found or coalesce(v_contract.status,'') not in ('active','trial') or
     coalesce(v_contract.package_code,'') <> 'custom' or
     coalesce(v_contract.metadata->'sales_modes'->>'recycling','') <> 'true' or
     (v_contract.ended_at is not null and v_contract.ended_at <= now()) then
    raise exception 'recycling_contract_not_authorized';
  end if;
  select lifecycle_status,access_locked,trial_expires_at,subscription_expires_at into v_lifecycle
    from public.tenant_data_lifecycle where tenant_id=p_tenant_id;
  if not found or coalesce(v_lifecycle.access_locked,true) or
     coalesce(v_lifecycle.lifecycle_status,'') not in ('trial','active') or
     (v_lifecycle.lifecycle_status='trial' and
      (v_lifecycle.trial_expires_at is null or v_lifecycle.trial_expires_at<=now())) or
     (v_lifecycle.lifecycle_status='active' and
      v_lifecycle.subscription_expires_at is not null and
      v_lifecycle.subscription_expires_at<=now()) then
    raise exception 'recycling_subscription_inactive';
  end if;
  if not exists (select 1 from public.tenants t join public.branches b
      on b.tenant_id=t.id where t.id=p_tenant_id and b.id=p_branch_id
      and t.is_active and b.is_active) then raise exception 'recycling_branch_invalid'; end if;
  -- Serialize cash movements for the entire shift, including different SKUs,
  -- so concurrent material purchases cannot overdraw the same cash drawer.
  select pg_catalog.round(coalesce(s.opening_cash,0)*100)::bigint
    into v_opening_cash_minor
    from public.shifts s where s.id=p_shift_id
      and s.tenant_id=p_tenant_id and s.branch_id=p_branch_id and s.status='open'
    for update;
  if not found then raise exception 'recycling_shift_closed'; end if;
  if v_opening_cash_minor<0 then raise exception 'recycling_shift_opening_cash_invalid'; end if;
  -- Mixing ordinary POS orders and weighed recycling in the same cash shift
  -- would omit standard POS payments from the recycler-only drawer ledger.
  if exists (select 1 from public.orders o
    where o.tenant_id=p_tenant_id and o.branch_id=p_branch_id
      and o.shift_id=p_shift_id limit 1) then
    raise exception 'recycling_mixed_legacy_shift_requires_reconciliation';
  end if;
  if not exists (select 1 from public.user_branch_roles u
    where u.tenant_id=p_tenant_id and u.branch_id=p_branch_id and u.user_id=p_user_id)
      then raise exception 'recycling_user_not_in_branch'; end if;

  v_id := pg_catalog.gen_random_uuid();
  -- Allocate under a tenant-scoped counter row lock within the same
  -- transaction as stock, cash and ledger posting. A failed post rolls
  -- the number back; completed/voided receipts retain their number.
  v_receipt_no := public.recycling_allocate_receipt_no(p_tenant_id);
  insert into public.recycling_transactions
    (id,tenant_id,branch_id,shift_id,operator_user_id,request_id,receipt_no,
     request_hash,direction,settlement,counterparty_name,total_minor,cogs_minor)
  values(v_id,p_tenant_id,p_branch_id,p_shift_id,p_user_id,p_request_id,v_receipt_no,
    v_request_hash,p_direction,p_settlement,btrim(p_counterparty_name),1,0);

  for v_index in 0..jsonb_array_length(p_lines)-1 loop
    v_line := p_lines -> v_index;
    if jsonb_typeof(v_line) is distinct from 'object' or
       coalesce(v_line->>'product_id','') !~* '^[a-f0-9-]{36}$' or
       coalesce(v_line->>'quantity','') !~ '^[0-9]{1,10}([.][0-9]{1,6})?$' then
      raise exception 'recycling_invalid_line';
    end if;
    v_unit := v_line->>'unit';
    if coalesce(v_unit,'') not in ('kg','khid','g','ton','piece','stem') then
      raise exception 'recycling_invalid_unit';
    end if;
    v_quantity := (v_line->>'quantity')::numeric;
    if v_quantity<=0 then raise exception 'recycling_quantity_must_be_positive'; end if;
    select id,sku,name,category,price,sell_unit,metadata into v_p from public.products
      where tenant_id=p_tenant_id and branch_id=p_branch_id
        and id=(v_line->>'product_id')::uuid
        and is_active=true and deleted_at is null
        and metadata->>'business_mode'='recycling'
      for update;
    if not found then raise exception 'recycling_product_not_found'; end if;
    v_basis := case when v_p.metadata->>'recycling_price_basis'='piece'
      then 'piece' else 'kg' end;
    if (v_unit in ('piece','stem')) <> (v_basis='piece') then raise exception 'recycling_unit_mismatch'; end if;
    if v_unit in ('piece','stem') and v_quantity<>trunc(v_quantity) then
      raise exception 'recycling_piece_must_be_whole'; end if;
    v_multiplier := case v_unit when 'ton' then 1000 when 'kg' then 1
      when 'khid' then 0.1 when 'g' then 0.001 else 1 end;
    v_base_quantity := v_quantity * v_multiplier;
    if v_base_quantity<0.001 and v_unit not in ('piece','stem') then raise exception 'recycling_below_gram_precision'; end if;
    if v_base_quantity>100000000 then raise exception 'recycling_quantity_too_large'; end if;
    v_price := case when p_direction='buy'
      then nullif(v_p.metadata->>'recycling_buy_price','')::numeric else v_p.price end;
    if v_price is null or v_price < 0 then raise exception 'recycling_price_missing'; end if;
    if v_price > 99999999 or v_price * v_base_quantity * 100 > 99999999999999 then
      raise exception 'recycling_amount_too_large';
    end if;
    -- Client price is an assertion only, never the server authority.
    if coalesce(v_line->>'expected_price','') !~ '^[0-9]{1,10}([.][0-9]{1,2})?$' then
      raise exception 'recycling_invalid_expected_price';
    end if;
    if (v_line->>'expected_price')::numeric <> v_price then
      raise exception 'recycling_price_changed_refresh_cart';
    end if;
    v_line_minor := round(v_price * v_base_quantity * 100)::bigint;
    if v_line_minor<=0 then raise exception 'recycling_line_amount_too_small'; end if;

    insert into public.recycling_stock_balances(tenant_id,branch_id,product_id)
      values(p_tenant_id,p_branch_id,v_p.id) on conflict do nothing;
    select quantity_base,carrying_cost_minor,last_transaction_id into v_stock
      from public.recycling_stock_balances where tenant_id=p_tenant_id
        and branch_id=p_branch_id and product_id=v_p.id for update;
    if p_direction='buy' then
      v_cost_minor := 0;
      v_new_qty := v_stock.quantity_base + v_base_quantity;
      v_new_value := v_stock.carrying_cost_minor + v_line_minor;
    else
      if v_stock.quantity_base < v_base_quantity then
        raise exception 'recycling_stock_insufficient';
      end if;
      v_cost_minor := case when v_stock.quantity_base=v_base_quantity
        then v_stock.carrying_cost_minor else
        round(v_stock.carrying_cost_minor * v_base_quantity / v_stock.quantity_base)::bigint end;
      v_new_qty := v_stock.quantity_base - v_base_quantity;
      v_new_value := v_stock.carrying_cost_minor - v_cost_minor;
    end if;
    update public.recycling_stock_balances set
      quantity_base=v_new_qty,carrying_cost_minor=v_new_value,
      last_transaction_id=v_id,updated_at=now()
      where tenant_id=p_tenant_id and branch_id=p_branch_id and product_id=v_p.id;
    insert into public.recycling_transaction_lines
      (transaction_id,tenant_id,branch_id,line_no,product_id,sku_snapshot,
       name_snapshot,category_snapshot,original_quantity,original_unit,
       base_quantity,base_unit,price_per_base,amount_minor,cogs_minor,
       stock_qty_before,stock_cost_before_minor,stock_last_transaction_before)
    values (v_id,p_tenant_id,p_branch_id,v_index+1,v_p.id,v_p.sku,
      v_p.name,v_p.category,v_quantity,v_unit,
      v_base_quantity,v_basis,v_price,v_line_minor,v_cost_minor,
      v_stock.quantity_base,v_stock.carrying_cost_minor,v_stock.last_transaction_id);
    v_total_minor := v_total_minor+v_line_minor;
    v_cogs_minor := v_cogs_minor+v_cost_minor;
  end loop;
  -- Item amounts and stock valuation are always pre-VAT, priced on the server.
  v_base_minor := v_total_minor;
  if p_direction='sell' then
    select is_enabled,settings into v_settings
      from public.tenant_tax_settings
      where tenant_id=p_tenant_id and branch_id=p_branch_id for share;
    if found and v_settings.is_enabled then
      if jsonb_typeof(v_settings.settings->'lines') is distinct from 'array' then
        raise exception 'recycling_vat_settings_invalid';
      end if;
      for v_vat_line in select value from jsonb_array_elements(v_settings.settings->'lines') loop
        if coalesce((v_vat_line->>'is_active')::boolean,false)
          and coalesce((v_vat_line->>'rate_pct')::numeric,0)>0 then
          v_active_lines := v_active_lines+1;
          if v_vat_line->>'mode'<>'add_to_bill'
             or coalesce((v_vat_line->>'rate_pct')::numeric,0)<>7
             or coalesce(v_vat_line->>'label','') !~* '(VAT|ภาษีมูลค่าเพิ่ม)' then
            raise exception 'recycling_vat_settings_unsupported';
          end if;
          v_vat_rate := 7;
        end if;
      end loop;
      if v_active_lines<>1 then raise exception 'recycling_vat_settings_unsupported'; end if;
      select * into v_issuer from public.recycling_vat_issuers
        where tenant_id=p_tenant_id and branch_id=p_branch_id and active
          and verified_at is not null
          and verified_from <= (now() at time zone 'Asia/Bangkok')::date
          and (verified_until is null or verified_until >= (now() at time zone 'Asia/Bangkok')::date)
        for share;
      if not found then raise exception 'recycling_vat_registration_not_verified'; end if;
      if not exists(select 1 from public.finance_accounting_chart
        where tenant_id=p_tenant_id and account_code='2200' and account_type='liability') then
        raise exception 'recycling_vat_account_not_ready';
      end if;
      v_vat_minor := round(v_base_minor::numeric * v_vat_rate / 100)::bigint;
      v_tax_state := 'vat_recorded';
      v_tax_snapshot := jsonb_build_object(
        'version',1,'mode','add_to_bill','rate_pct',v_vat_rate,
        'seller',jsonb_build_object(
           'display_name',v_issuer.legal_name,'address',v_issuer.legal_address,
           'tax_id',v_issuer.tax_id,'branch_no',v_issuer.branch_no),
        'issuer_verified_at',v_issuer.verified_at,
        'issuer_evidence_reference',v_issuer.evidence_reference,
        'calculated_at',now());
    end if;
  end if;
  if v_base_minor + v_vat_minor>99999999999999 then raise exception 'recycling_total_too_large'; end if;
  v_total_minor := v_base_minor+v_vat_minor;
  update public.recycling_transactions
    set total_minor=v_total_minor,cogs_minor=v_cogs_minor,
        base_minor=v_base_minor,vat_minor=v_vat_minor,
        tax_state=v_tax_state,tax_snapshot=v_tax_snapshot where id=v_id;

  if p_direction='buy' and p_settlement='cash' then
    select v_opening_cash_minor +
      coalesce(sum(case when direction='sell' then total_minor else -total_minor end),0)
      into v_cash_balance_minor
      from public.recycling_transactions
      where tenant_id=p_tenant_id and branch_id=p_branch_id
        and shift_id=p_shift_id and status='posted' and settlement='cash';
    if v_cash_balance_minor<0 then
      raise exception 'recycling_cash_drawer_insufficient';
    end if;
  end if;
  v_cash_code := case p_settlement when 'cash' then '1100'
    when 'bank_transfer' then '1110'
    else case p_direction when 'buy' then '2100' else '1201' end end;
  v_cash_name := case p_settlement when 'cash' then 'เงินสด'
    when 'bank_transfer' then 'เงินฝากธนาคาร'
    else case p_direction when 'buy' then 'เจ้าหนี้รับซื้อวัสดุ' else 'ลูกหนี้การค้า' end end;

  if p_direction='buy' then
    insert into public.recycling_accounting_entries(transaction_id,tenant_id,branch_id,line_no,account_code,account_name,debit_minor)
      values (v_id,p_tenant_id,p_branch_id,1,'1200','สินค้าคงเหลือวัสดุรีไซเคิล',v_total_minor);
    insert into public.recycling_accounting_entries(transaction_id,tenant_id,branch_id,line_no,account_code,account_name,credit_minor)
      values (v_id,p_tenant_id,p_branch_id,2,v_cash_code,v_cash_name,v_total_minor);
  else
    insert into public.recycling_accounting_entries(transaction_id,tenant_id,branch_id,line_no,account_code,account_name,debit_minor)
      values (v_id,p_tenant_id,p_branch_id,1,v_cash_code,v_cash_name,v_total_minor);
    insert into public.recycling_accounting_entries(transaction_id,tenant_id,branch_id,line_no,account_code,account_name,credit_minor)
      values (v_id,p_tenant_id,p_branch_id,2,'4100','รายได้ขายวัสดุรีไซเคิล',v_base_minor);
    if v_vat_minor>0 then
      insert into public.recycling_accounting_entries
        (transaction_id,tenant_id,branch_id,line_no,account_code,account_name,credit_minor)
      values(v_id,p_tenant_id,p_branch_id,5,'2200','ภาษีขายรอนำส่ง',v_vat_minor);
    end if;
    if v_cogs_minor>0 then
      insert into public.recycling_accounting_entries(transaction_id,tenant_id,branch_id,line_no,account_code,account_name,debit_minor)
        values (v_id,p_tenant_id,p_branch_id,3,'5100','ต้นทุนขายวัสดุรีไซเคิล',v_cogs_minor);
      insert into public.recycling_accounting_entries(transaction_id,tenant_id,branch_id,line_no,account_code,account_name,credit_minor)
        values (v_id,p_tenant_id,p_branch_id,4,'1200','สินค้าคงเหลือวัสดุรีไซเคิล',v_cogs_minor);
    end if;
  end if;
  if (select coalesce(sum(debit_minor-credit_minor),0)
    from public.recycling_accounting_entries where transaction_id=v_id) <> 0 then
    raise exception 'recycling_ledger_not_balanced';
  end if;
  return jsonb_build_object('id',v_id,'receipt_no',v_receipt_no,
    'total_minor',v_total_minor,'base_minor',v_base_minor,'vat_minor',v_vat_minor,'tax_state',v_tax_state,'cogs_minor',v_cogs_minor,'idempotent',false);
end;
$function$;

revoke all on function public.recycling_post_transaction_vat(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.recycling_post_transaction_vat(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb) to service_role;
-- Existing Finance approvals gain a 2200 output-VAT liability mapping, preserved
-- historical NULL tax snapshots, and base-vs-gross reconciliation.
CREATE OR REPLACE FUNCTION public.recycling_finance_post_transaction(p_tenant_id uuid, p_branch_id uuid, p_transaction_id uuid, p_accountant_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if v_line_count<2 or v_line_count>5 or v_debits<=0 or v_debits<>v_credits
    then raise exception 'recycling_finance_unbalanced_subledger'; end if;
  if v_debits <> (v_tx.total_minor +
       (case when v_tx.direction='sell' then v_tx.cogs_minor else 0 end))
    then raise exception 'recycling_finance_subledger_total_mismatch'; end if;

  select count(*),coalesce(sum(amount_minor),0)
    into v_line_count,v_amount
    from public.recycling_transaction_lines
   where transaction_id=v_tx.id and tenant_id=p_tenant_id and branch_id=p_branch_id;
  if v_line_count<1 or v_line_count>100 or v_amount <> coalesce(v_tx.base_minor,v_tx.total_minor)
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
      when '2100' then 'liability' when '2200' then 'liability' when '4100' then 'income'
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
  -- Preserve exactly the same immutable reference printed on the
  -- non-tax Recycling purchase/sale receipt.
  v_document_no := v_tx.receipt_no;
  v_payment_method := case v_tx.settlement when 'bank_transfer'
    then 'transfer' when 'cash' then 'cash' else 'other' end;

  insert into public.finance_accounting_documents
    (tenant_id,branch_id,document_kind,document_no,payment_method,
     counterparty_name,document_date,currency,amount_minor,tax_minor,status,
     request_key,request_snapshot,prepared_by,approved_by,approved_at,issued_at)
  values
    (p_tenant_id,p_branch_id,v_document_kind,v_document_no,v_payment_method,
     v_tx.counterparty_name,v_document_date,'THB',v_tx.total_minor,coalesce(v_tx.vat_minor,0),'issued',
     v_tx.id,pg_catalog.jsonb_build_object(
       'source','recycling','recycling_transaction_id',v_tx.id,
       'direction',v_tx.direction,'settlement',v_tx.settlement,
       'cogs_minor',v_tx.cogs_minor,'base_minor',v_tx.base_minor,'vat_minor',v_tx.vat_minor,'tax_state',v_tx.tax_state,'approval_source','accountant_review',
       'not_tax_invoice',true
     ),v_tx.operator_user_id,p_accountant_user_id,now(),now())
  returning id into v_doc;

  -- Positive purchase/sale lines mirror source quantities and amounts.
  for v_line in
    select l.line_no,l.name_snapshot as name,l.original_quantity,l.original_unit,
       l.price_per_base,l.amount_minor
    from public.recycling_transaction_lines l
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
$function$;

revoke all on function public.recycling_finance_post_transaction(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.recycling_finance_post_transaction(uuid,uuid,uuid,uuid) to service_role;
commit;
