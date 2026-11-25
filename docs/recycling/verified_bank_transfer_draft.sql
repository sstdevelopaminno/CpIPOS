-- DEVELOPMENT DRAFT ONLY. Do not apply to CpiPOS-001.
-- Must be reviewed with current live schema, run isolated PostgreSQL UAT,
-- and converted into an approved canonical migration before activation.
-- Manual bank-statement verification is human attestation, NOT bank API verification.
begin;
create table public.recycling_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  bank_code text not null check(bank_code ~ '^[A-Z0-9]{2,12}$'),
  account_last4 text not null check(account_last4 ~ '^[0-9]{4}$'),
  account_label text not null check(length(btrim(account_label)) between 2 and 120),
  evidence_reference text not null check(length(btrim(evidence_reference)) between 5 and 500),
  verified_by uuid not null references public.users_profiles(id),
  verified_at timestamptz not null,
  active boolean not null default false,
  unique(tenant_id,branch_id,id),
  foreign key(tenant_id,branch_id) references public.branches(tenant_id,id)
);
create table public.recycling_bank_transfer_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  shift_id uuid not null references public.shifts(id),
  bank_account_id uuid not null,
  bank_code text not null check(bank_code ~ '^[A-Z0-9]{2,12}$'),
  request_id uuid not null,
  operator_user_id uuid not null references public.users_profiles(id),
  direction text not null check(direction in ('buy','sell')),
  request_hash text not null check(request_hash ~ '^[0-9a-f]{32}$'),
  bank_reference text not null check(bank_reference ~ '^[A-Z0-9-]{6,100}$'),
  amount_minor bigint not null check(amount_minor between 1 and 99999999999999),
  transfer_at timestamptz not null,
  statement_evidence_reference text not null check(length(btrim(statement_evidence_reference)) between 5 and 500),
  verified_by uuid not null references public.users_profiles(id),
  verified_at timestamptz not null default now(),
  consumed_transaction_id uuid unique references public.recycling_transactions(id),
  consumed_at timestamptz,
  check(verified_by<>operator_user_id),
  check((consumed_transaction_id is null)=(consumed_at is null)),
  unique(tenant_id,branch_id,request_id),
  unique(tenant_id,bank_code,bank_reference),
  foreign key(tenant_id,branch_id,bank_account_id)
    references public.recycling_bank_accounts(tenant_id,branch_id,id)
);
alter table public.recycling_bank_accounts enable row level security;
alter table public.recycling_bank_transfer_evidence enable row level security;
revoke all on public.recycling_bank_accounts,public.recycling_bank_transfer_evidence from public,anon,authenticated;
grant select,insert,update on public.recycling_bank_accounts,public.recycling_bank_transfer_evidence to service_role;

-- Trusted server must authenticate the independent reviewer and establish
-- that the referenced statement entry was actually checked. Never pass
-- reviewer identity directly from untrusted client JSON or auto-approve OCR.
create function public.recycling_record_bank_transfer_evidence(
  p_tenant_id uuid,p_branch_id uuid,p_shift_id uuid,p_user_id uuid,
  p_request_id uuid,p_direction text,p_counterparty_name text,p_lines jsonb,
  p_bank_account_id uuid,p_bank_reference text,p_amount_minor bigint,
  p_transfer_at timestamptz,p_statement_evidence_reference text,p_verified_by uuid
) returns uuid language plpgsql set search_path to '' as $function$
declare
  v_account public.recycling_bank_accounts%rowtype;
  v_hash text;
  v_id uuid;
begin
  if p_user_id is null or p_verified_by is null or p_user_id=p_verified_by
    or p_request_id is null or coalesce(p_direction,'') not in ('buy','sell')
    or p_amount_minor is null or p_amount_minor not between 1 and 99999999999999
    or p_transfer_at is null or p_transfer_at>now()
    or jsonb_typeof(p_lines) is distinct from 'array'
    or length(btrim(coalesce(p_counterparty_name,''))) not between 1 and 240
    or coalesce(p_bank_reference,'') !~ '^[A-Z0-9-]{6,100}$'
    or length(btrim(coalesce(p_statement_evidence_reference,''))) not between 5 and 500
  then raise exception 'recycling_bank_evidence_invalid'; end if;
  if jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'recycling_lines_required';
  end if;
  if not exists(select 1 from public.user_branch_roles u join public.users_profiles up on up.id=u.user_id
    where u.tenant_id=p_tenant_id and u.branch_id=p_branch_id and u.user_id=p_verified_by
      and u.role::text in ('owner','manager','accountant') and up.is_active)
    or not exists(select 1 from public.user_branch_roles u join public.users_profiles up on up.id=u.user_id
      where u.tenant_id=p_tenant_id and u.branch_id=p_branch_id and u.user_id=p_user_id and up.is_active)
  then raise exception 'recycling_bank_reviewer_forbidden'; end if;
  if not exists(select 1 from public.shifts s where s.id=p_shift_id and s.tenant_id=p_tenant_id
      and s.branch_id=p_branch_id and s.status='open'
      and s.metadata->>'business_shift_mode'='recycling_daily'
      and p_transfer_at>=s.opened_at
      and (p_transfer_at at time zone 'Asia/Bangkok')::date=(now() at time zone 'Asia/Bangkok')::date)
  then raise exception 'recycling_bank_shift_invalid'; end if;
  select * into v_account from public.recycling_bank_accounts
    where id=p_bank_account_id and tenant_id=p_tenant_id and branch_id=p_branch_id and active;
  if not found then raise exception 'recycling_bank_account_not_ready'; end if;
  if not exists(select 1 from public.finance_accounting_chart
    where tenant_id=p_tenant_id and account_code='1110' and account_type='asset')
  then raise exception 'recycling_bank_account_not_ready'; end if;
  v_hash:=pg_catalog.md5(pg_catalog.jsonb_build_object('shift_id',p_shift_id,'user_id',p_user_id,
    'direction',p_direction,'settlement','bank_transfer','counterparty',btrim(p_counterparty_name),
    'lines',p_lines)::text);
  insert into public.recycling_bank_transfer_evidence(tenant_id,branch_id,shift_id,bank_account_id,bank_code,
    request_id,operator_user_id,direction,request_hash,bank_reference,amount_minor,transfer_at,
    statement_evidence_reference,verified_by)
  values(p_tenant_id,p_branch_id,p_shift_id,p_bank_account_id,v_account.bank_code,p_request_id,p_user_id,p_direction,
    v_hash,p_bank_reference,p_amount_minor,p_transfer_at,btrim(p_statement_evidence_reference),p_verified_by)
  returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.recycling_record_bank_transfer_evidence(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,bigint,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.recycling_record_bank_transfer_evidence(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid,text,bigint,timestamptz,text,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.recycling_post_transaction_verified_bank(p_tenant_id uuid, p_branch_id uuid, p_shift_id uuid, p_user_id uuid, p_request_id uuid, p_direction text, p_settlement text, p_counterparty_name text, p_lines jsonb)
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
  v_evidence public.recycling_bank_transfer_evidence%rowtype;
begin
  if p_tenant_id is null or p_branch_id is null or p_shift_id is null or
     p_user_id is null or p_request_id is null then
    raise exception 'recycling_invalid_identity';
  end if;
  if coalesce(p_direction,'') not in ('buy','sell') or
     coalesce(p_settlement,'') not in ('cash','bank_transfer','credit') then
    raise exception 'recycling_invalid_direction_or_settlement';
  end if;
  -- This RPC is bank-only; the original cash/VAT RPCs remain unchanged.
  if p_settlement is distinct from 'bank_transfer' then
    raise exception 'recycling_verified_bank_only';
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

  -- The evidence row is locked in the same transaction as posting. Bind it
  -- to the original cart, shift, operator, and verified bank account.
  select e.* into v_evidence from public.recycling_bank_transfer_evidence e
  join public.recycling_bank_accounts a on a.id=e.bank_account_id
    and a.tenant_id=e.tenant_id and a.branch_id=e.branch_id
  where e.tenant_id=p_tenant_id and e.branch_id=p_branch_id
    and e.shift_id=p_shift_id and e.operator_user_id=p_user_id
    and e.request_id=p_request_id and e.direction=p_direction
    and e.request_hash=v_request_hash and e.consumed_transaction_id is null
    and a.active and a.verified_at is not null
    and e.verified_by<>p_user_id
    and exists (select 1 from public.user_branch_roles u join public.users_profiles up on up.id=u.user_id
      where u.tenant_id=p_tenant_id and u.branch_id=p_branch_id
        and u.user_id=e.verified_by and u.role::text in ('owner','manager','accountant') and up.is_active)
  for update of e;
  if not found then raise exception 'recycling_bank_transfer_verification_required'; end if;
  if not exists(select 1 from public.finance_accounting_chart
    where tenant_id=p_tenant_id and account_code='1110' and account_type='asset') then
    raise exception 'recycling_bank_account_not_ready';
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
  if v_evidence.amount_minor is distinct from v_total_minor then
    raise exception 'recycling_bank_amount_mismatch';
  end if;
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
  update public.recycling_bank_transfer_evidence set consumed_transaction_id=v_id, consumed_at=now()
    where id=v_evidence.id and consumed_transaction_id is null;
  if not found then raise exception 'recycling_bank_evidence_already_consumed'; end if;
  return jsonb_build_object('id',v_id,'receipt_no',v_receipt_no,
    'total_minor',v_total_minor,'base_minor',v_base_minor,'vat_minor',v_vat_minor,'tax_state',v_tax_state,'cogs_minor',v_cogs_minor,'idempotent',false);
end;
$function$;
revoke all on function public.recycling_post_transaction_verified_bank(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.recycling_post_transaction_verified_bank(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb) to service_role;
-- Pending cashier intents contain a frozen cart; review never trusts a
-- reviewer-selected operator, branch, request, or edited cart.
create table public.recycling_bank_transfer_intents (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 branch_id uuid not null references public.branches(id),
 shift_id uuid not null references public.shifts(id),
 operator_user_id uuid not null references public.users_profiles(id),
 request_id uuid not null,
 direction text not null check(direction in ('buy','sell')),
 counterparty_name text not null check(length(btrim(counterparty_name)) between 1 and 240),
 lines jsonb not null check(jsonb_typeof(lines)='array' and jsonb_array_length(lines) between 1 and 100),
 expected_minor bigint not null check(expected_minor between 1 and 99999999999999),
 evidence_id uuid unique references public.recycling_bank_transfer_evidence(id),
 created_at timestamptz not null default now(),
 unique(tenant_id,branch_id,request_id),
 foreign key(tenant_id,branch_id) references public.branches(tenant_id,id)
);
alter table public.recycling_bank_transfer_intents enable row level security;
revoke all on public.recycling_bank_transfer_intents from public,anon,authenticated;
grant select,insert,update on public.recycling_bank_transfer_intents to service_role;
create function public.recycling_submit_bank_transfer_intent(
 p_tenant_id uuid,p_branch_id uuid,p_shift_id uuid,p_user_id uuid,p_request_id uuid,
 p_direction text,p_counterparty_name text,p_lines jsonb,p_expected_minor bigint
) returns uuid language plpgsql set search_path to '' as $function$
declare v_intent public.recycling_bank_transfer_intents%rowtype;
begin
 if not exists(select 1 from public.user_branch_roles r join public.users_profiles u on u.id=r.user_id
   where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.user_id=p_user_id and u.is_active)
 then raise exception 'recycling_bank_operator_forbidden'; end if;
 if not exists(select 1 from public.shifts s where s.id=p_shift_id and s.tenant_id=p_tenant_id
   and s.branch_id=p_branch_id and s.status='open' and s.metadata->>'business_shift_mode'='recycling_daily'
   and (s.opened_at at time zone 'Asia/Bangkok')::date=(now() at time zone 'Asia/Bangkok')::date)
 then raise exception 'recycling_bank_shift_invalid'; end if;
 if not exists(select 1 from public.recycling_bank_accounts a where a.tenant_id=p_tenant_id and a.branch_id=p_branch_id and a.active)
 then raise exception 'recycling_bank_account_not_ready'; end if;
 if exists(select 1 from public.recycling_transactions t where t.tenant_id=p_tenant_id and t.branch_id=p_branch_id and t.request_id=p_request_id)
 then raise exception 'recycling_bank_request_already_posted'; end if;
 insert into public.recycling_bank_transfer_intents(tenant_id,branch_id,shift_id,operator_user_id,request_id,direction,counterparty_name,lines,expected_minor)
 values(p_tenant_id,p_branch_id,p_shift_id,p_user_id,p_request_id,p_direction,btrim(p_counterparty_name),p_lines,p_expected_minor)
 on conflict(tenant_id,branch_id,request_id) do nothing;
 select * into v_intent from public.recycling_bank_transfer_intents where tenant_id=p_tenant_id and branch_id=p_branch_id and request_id=p_request_id for update;
 if not found or v_intent.operator_user_id is distinct from p_user_id or v_intent.shift_id is distinct from p_shift_id
   or v_intent.direction is distinct from p_direction or v_intent.counterparty_name is distinct from btrim(p_counterparty_name)
   or v_intent.lines is distinct from p_lines or v_intent.expected_minor is distinct from p_expected_minor
 then raise exception 'recycling_request_key_reused'; end if;
 return v_intent.id;
end;
$function$;
create function public.recycling_review_bank_transfer_intent(
 p_tenant_id uuid,p_branch_id uuid,p_intent_id uuid,p_verified_by uuid,p_bank_account_id uuid,
 p_bank_reference text,p_amount_minor bigint,p_transfer_at timestamptz,p_statement_evidence_reference text
) returns uuid language plpgsql set search_path to '' as $function$
declare v_intent public.recycling_bank_transfer_intents%rowtype; v_id uuid;
begin
 if not exists(select 1 from public.user_branch_roles r join public.users_profiles u on u.id=r.user_id
   where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.user_id=p_verified_by
   and r.role::text in ('owner','manager','accountant') and u.is_active)
 then raise exception 'recycling_bank_reviewer_forbidden'; end if;
 select * into v_intent from public.recycling_bank_transfer_intents where id=p_intent_id and tenant_id=p_tenant_id and branch_id=p_branch_id for update;
 if not found then raise exception 'recycling_bank_intent_not_found'; end if;
 if v_intent.operator_user_id=p_verified_by then raise exception 'recycling_bank_reviewer_forbidden'; end if;
 if v_intent.evidence_id is not null then
   if exists(select 1 from public.recycling_bank_transfer_evidence e where e.id=v_intent.evidence_id
     and e.verified_by=p_verified_by and e.bank_account_id=p_bank_account_id
     and e.bank_reference=p_bank_reference and e.amount_minor=p_amount_minor
     and e.transfer_at=p_transfer_at and e.statement_evidence_reference=btrim(p_statement_evidence_reference))
   then return v_intent.evidence_id; end if;
   raise exception 'recycling_bank_intent_already_approved';
 end if;
 if p_amount_minor is distinct from v_intent.expected_minor then raise exception 'recycling_bank_amount_mismatch'; end if;
 v_id:=public.recycling_record_bank_transfer_evidence(p_tenant_id,p_branch_id,v_intent.shift_id,v_intent.operator_user_id,
   v_intent.request_id,v_intent.direction,v_intent.counterparty_name,v_intent.lines,p_bank_account_id,p_bank_reference,
   p_amount_minor,p_transfer_at,p_statement_evidence_reference,p_verified_by);
 update public.recycling_bank_transfer_intents set evidence_id=v_id where id=v_intent.id;
 return v_id;
end;
$function$;
revoke all on function public.recycling_submit_bank_transfer_intent(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.recycling_submit_bank_transfer_intent(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,bigint) to service_role;
revoke all on function public.recycling_review_bank_transfer_intent(uuid,uuid,uuid,uuid,uuid,text,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function public.recycling_review_bank_transfer_intent(uuid,uuid,uuid,uuid,uuid,text,bigint,timestamptz,text) to service_role;

commit;
