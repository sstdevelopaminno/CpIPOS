-- CUSTOM Recycling ONLY. Transactional, non-recycled tenant-wide document numbers.
-- Historical RCY-B-YYYYMMDD-UUID and RCY-S-YYYYMMDD-UUID references
-- remain unchanged and must continue to resolve for audits and reprints.
-- Sequence shared by BUY and SELL across all branches of the same tenant.
CREATE TABLE IF NOT EXISTS public.recycling_receipt_counters (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  last_number bigint NOT NULL CHECK (last_number BETWEEN 1 AND 999999999),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recycling_receipt_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recycling_receipt_counters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.recycling_receipt_counters TO service_role;

-- Seed from prior modern-format documents only; never renumber old ones.
INSERT INTO public.recycling_receipt_counters(tenant_id,last_number)
SELECT tenant_id, max(substring(receipt_no from '^RCY-([0-9]+)$')::bigint)
FROM public.recycling_transactions
WHERE receipt_no ~ '^RCY-[0-9]{4,}$'
GROUP BY tenant_id
ON CONFLICT (tenant_id) DO UPDATE
SET last_number=greatest(public.recycling_receipt_counters.last_number, EXCLUDED.last_number),
    updated_at=now();

-- Uniqueness across branches is essential: RCY-0001 must refer to a single
-- document within a tenant, not one duplicate per branch.
CREATE UNIQUE INDEX IF NOT EXISTS recycling_transactions_tenant_receipt_unique
 ON public.recycling_transactions (tenant_id,receipt_no);

CREATE OR REPLACE FUNCTION public.recycling_allocate_receipt_no(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $recycling_seq$
DECLARE v_value bigint;
BEGIN
  IF p_tenant_id IS NULL THEN RAISE EXCEPTION 'recycling_invalid_tenant'; END IF;
  INSERT INTO public.recycling_receipt_counters(tenant_id,last_number,updated_at)
  VALUES(p_tenant_id,1,now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET last_number=public.recycling_receipt_counters.last_number+1,
        updated_at=now()
  RETURNING last_number INTO v_value;
  IF v_value IS NULL OR v_value > 999999999 THEN
    RAISE EXCEPTION 'recycling_receipt_sequence_exhausted';
  END IF;
  RETURN 'RCY-'||pg_catalog.lpad(v_value::text,4,'0');
END;
$recycling_seq$;

REVOKE ALL ON FUNCTION public.recycling_allocate_receipt_no(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recycling_allocate_receipt_no(uuid) TO service_role;

-- Keep the existing validated, idempotent atomic RPC intact except for
-- the document-number allocation. Do not rewrite stock/cash/accounting
-- or privilege logic while changing the format.
CREATE OR REPLACE FUNCTION public.recycling_post_transaction(p_tenant_id uuid, p_branch_id uuid, p_shift_id uuid, p_user_id uuid, p_request_id uuid, p_direction text, p_settlement text, p_counterparty_name text, p_lines jsonb)
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
  select id,receipt_no,total_minor,cogs_minor,request_hash into v_existing from public.recycling_transactions
    where tenant_id=p_tenant_id and branch_id=p_branch_id and request_id=p_request_id;
  if found then
    if v_existing.request_hash is distinct from v_request_hash then
      raise exception 'recycling_request_key_reused';
    end if;
    return jsonb_build_object('id',v_existing.id,'receipt_no',v_existing.receipt_no,
      'total_minor',v_existing.total_minor,'cogs_minor',v_existing.cogs_minor,'idempotent',true);
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
  if v_total_minor>99999999999999 then raise exception 'recycling_total_too_large'; end if;
  update public.recycling_transactions
    set total_minor=v_total_minor,cogs_minor=v_cogs_minor where id=v_id;

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
      values (v_id,p_tenant_id,p_branch_id,2,'4100','รายได้ขายวัสดุรีไซเคิล',v_total_minor);
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
    'total_minor',v_total_minor,'cogs_minor',v_cogs_minor,'idempotent',false);
end;
$function$

