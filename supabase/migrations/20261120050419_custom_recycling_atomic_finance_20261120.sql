-- CpiPOS CUSTOM Recycling v1 — prepared migration; NOT APPLIED TO PRODUCTION.
-- Released only after paid Supabase staging/UAT review and a controlled
-- coordinated POS + IT deployment. Never use this migration to seed/alter
-- tenant 155858 or any other customer record. The customer's CUSTOM package
-- is explicitly granted by IT only after acceptance.
--
-- All new public tables have RLS enabled and their direct privileges are
-- restricted to service_role. Cashier routes require a verified POS session,
-- branch, active shift and explicit current CUSTOM Recycling entitlement.
-- Ordinary POS tenants must remain unaffected.
-- This migration itself does NOT enable any runtime write/GL/VOID flag.
--
-- Order: stock + atomic purchase/sale + closed-shift cash guard, independent
-- Finance GL approval bridge, restricted supervisor VOID-before-GL.
-- The DDL is transactionally atomic; duplicate/partial schema fails closed.
BEGIN;
DO $migration_preflight$
BEGIN
  IF pg_catalog.to_regclass('public.recycling_transactions') IS NOT NULL OR
     pg_catalog.to_regclass('public.recycling_stock_balances') IS NOT NULL OR
     pg_catalog.to_regclass('public.recycling_transaction_lines') IS NOT NULL OR
     pg_catalog.to_regclass('public.recycling_accounting_entries') IS NOT NULL
  THEN RAISE EXCEPTION 'recycling_v1_schema_already_exists_review_required'; END IF;
  IF pg_catalog.to_regclass('public.finance_accounting_documents') IS NULL OR
     pg_catalog.to_regclass('public.finance_accounting_journals') IS NULL OR
     pg_catalog.to_regclass('public.finance_accounting_chart') IS NULL OR
     pg_catalog.to_regclass('public.tenant_data_lifecycle') IS NULL
  THEN RAISE EXCEPTION 'recycling_v1_prerequisite_schema_missing'; END IF;
END;
$migration_preflight$;

-- PHASE 2: tenant/branch stock + purchase/sale
create table public.recycling_stock_balances (
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  quantity_base numeric(18,6) not null default 0 check (quantity_base >= 0),
  carrying_cost_minor bigint not null default 0 check (carrying_cost_minor >= 0),
  last_transaction_id uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id,branch_id,product_id)
);

create table public.recycling_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  shift_id uuid not null references public.shifts(id),
  operator_user_id uuid not null references public.users_profiles(id),
  request_id uuid not null,
  receipt_no text not null check (length(receipt_no) between 12 and 90),
  request_hash text not null check (length(request_hash)=32),
  finance_document_id uuid unique references public.finance_accounting_documents(id),
  constraint recycling_finance_doc_same_branch foreign key
    (tenant_id,branch_id,finance_document_id)
    references public.finance_accounting_documents(tenant_id,branch_id,id),
  direction text not null check (direction in ('buy','sell')),
  settlement text not null check (settlement in ('cash','bank_transfer','credit')),
  counterparty_name text not null check (length(btrim(counterparty_name)) between 1 and 240),
  total_minor bigint not null check (total_minor > 0),
  cogs_minor bigint not null check (cogs_minor >= 0),
  status text not null default 'posted' check (status in ('posted','voided')),
  voided_at timestamptz,
  voided_by uuid references public.users_profiles(id),
  void_reason text,
  void_request_id uuid,
  void_cash_confirmed boolean,
  void_stock_confirmed boolean,
  created_at timestamptz not null default now(),
  constraint recycling_void_audit_complete check (
    (status='posted' and voided_at is null and voided_by is null and void_reason is null)
    or (status='voided' and voided_at is not null and voided_by is not null
      and length(btrim(void_reason)) between 10 and 500 and void_request_id is not null
      and void_stock_confirmed is true)
  ),
  unique (tenant_id,branch_id,id),
  unique (tenant_id,branch_id,request_id),
  unique (tenant_id,branch_id,receipt_no),
  unique (tenant_id,branch_id,void_request_id)
);
create index recycling_transactions_tenant_branch_created_idx
  on public.recycling_transactions(tenant_id,branch_id,created_at desc);
create index recycling_transactions_shift_status_idx
  on public.recycling_transactions(tenant_id,branch_id,shift_id,status);

create table public.recycling_transaction_lines (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.recycling_transactions(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  constraint recycling_line_same_branch foreign key(tenant_id,branch_id,transaction_id)
    references public.recycling_transactions(tenant_id,branch_id,id),
  line_no int not null check (line_no between 1 and 100),
  product_id uuid not null references public.products(id),
  sku_snapshot text not null,
  name_snapshot text not null,
  category_snapshot text not null,
  original_quantity numeric(18,6) not null check (original_quantity > 0),
  original_unit text not null check (original_unit in ('kg','khid','g','ton','piece','stem')),
  base_quantity numeric(18,6) not null check (base_quantity > 0),
  base_unit text not null check (base_unit in ('kg','piece')),
  price_per_base numeric(16,2) not null check (price_per_base >= 0),
  amount_minor bigint not null check (amount_minor >= 0),
  cogs_minor bigint not null default 0 check (cogs_minor >= 0),
  stock_qty_before numeric(18,6) not null check (stock_qty_before>=0),
  stock_cost_before_minor bigint not null check (stock_cost_before_minor>=0),
  stock_last_transaction_before uuid,
  unique (transaction_id,line_no)
);

create table public.recycling_accounting_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.recycling_transactions(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  constraint recycling_entry_same_branch foreign key(tenant_id,branch_id,transaction_id)
    references public.recycling_transactions(tenant_id,branch_id,id),
  line_no int not null check (line_no between 1 and 10),
  account_code text not null check (account_code in ('1100','1110','1200','2100','1201','4100','5100')),
  account_name text not null,
  debit_minor bigint not null default 0 check (debit_minor >= 0),
  credit_minor bigint not null default 0 check (credit_minor >= 0),
  constraint recycling_entry_exactly_one_side check (
    (debit_minor > 0 and credit_minor=0) or (debit_minor=0 and credit_minor > 0)
  ),
  unique(transaction_id,line_no)
);

-- Do not expose these accounting/stock internals directly through the Data API.
alter table public.recycling_stock_balances enable row level security;
alter table public.recycling_transactions enable row level security;
alter table public.recycling_transaction_lines enable row level security;
alter table public.recycling_accounting_entries enable row level security;
revoke all on public.recycling_stock_balances from anon,authenticated;
revoke all on public.recycling_transactions from anon,authenticated;
revoke all on public.recycling_transaction_lines from anon,authenticated;
revoke all on public.recycling_accounting_entries from anon,authenticated;

-- Restrict all new tables to trusted server role. End-user routes use
-- authenticated Next.js session checks and service_role only server-side.
grant select,insert,update,delete on public.recycling_stock_balances to service_role;
grant select,insert,update,delete on public.recycling_transactions to service_role;
grant select,insert,update,delete on public.recycling_transaction_lines to service_role;
grant select,insert,update,delete on public.recycling_accounting_entries to service_role;

create or replace function public.recycling_post_transaction(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_shift_id uuid,
  p_user_id uuid,
  p_request_id uuid,
  p_direction text,
  p_settlement text,
  p_counterparty_name text,
  p_lines jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
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
  v_receipt_no := 'RCY-'||case p_direction when 'buy' then 'B' else 'S' end||
    '-'||pg_catalog.to_char(now() at time zone 'Asia/Bangkok','YYYYMMDD')||
    '-'||pg_catalog.substr(pg_catalog.replace(v_id::text,'-',''),1,12);
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
$fn$;

-- Security: this RPC is server-side only; grant only to service_role.
revoke all on function public.recycling_post_transaction(
 uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb
) from public,anon,authenticated;
grant execute on function public.recycling_post_transaction(
 uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb
) to service_role;

-- Separate, read-only, branch-scoped cash/transfer shift report.
-- Covers only verified Recycling transactions; ordinary POS orders may not mix.
create or replace function public.recycling_shift_totals(
  p_tenant_id uuid,p_branch_id uuid,p_shift_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $shift$
declare
  v_buy_count bigint;
  v_sell_count bigint;
  v_cash_in bigint;
  v_cash_out bigint;
  v_transfer_in bigint;
  v_transfer_out bigint;
  v_credit_in bigint;
  v_credit_out bigint;
begin
  if not exists (select 1 from public.shifts s where s.tenant_id=p_tenant_id
     and s.branch_id=p_branch_id and s.id=p_shift_id) then
    raise exception 'recycling_shift_not_found';
  end if;
  select
    count(*) filter(where direction='buy'),
    count(*) filter(where direction='sell'),
    coalesce(sum(total_minor) filter(where direction='sell' and settlement='cash'),0),
    coalesce(sum(total_minor) filter(where direction='buy' and settlement='cash'),0),
    coalesce(sum(total_minor) filter(where direction='sell' and settlement='bank_transfer'),0),
    coalesce(sum(total_minor) filter(where direction='buy' and settlement='bank_transfer'),0),
    coalesce(sum(total_minor) filter(where direction='sell' and settlement='credit'),0),
    coalesce(sum(total_minor) filter(where direction='buy' and settlement='credit'),0)
    into v_buy_count,v_sell_count,v_cash_in,v_cash_out,
      v_transfer_in,v_transfer_out,v_credit_in,v_credit_out
  from public.recycling_transactions
  where tenant_id=p_tenant_id and branch_id=p_branch_id
    and shift_id=p_shift_id and status='posted';
  return pg_catalog.jsonb_build_object(
    'buy_count',v_buy_count,'sell_count',v_sell_count,
    'cash_in_minor',v_cash_in,'cash_out_minor',v_cash_out,
    'cash_net_minor',v_cash_in-v_cash_out,
    'transfer_in_minor',v_transfer_in,'transfer_out_minor',v_transfer_out,
    'credit_in_minor',v_credit_in,'credit_out_minor',v_credit_out
  );
end;
$shift$;
revoke all on function public.recycling_shift_totals(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.recycling_shift_totals(uuid,uuid,uuid)
  to service_role;

-- Final transactional safeguard: the existing POS close service updates the
-- shift in multiple steps. This trigger executes under the shift row lock
-- and recomputes Recycling drawer cash from committed transactions, so a
-- concurrent buy/sell cannot be omitted from the official closed-shift total.
-- It does nothing for a shift with zero Recycling transactions.
-- A trigger runs on *every* shift status change, including older POS
-- clients whose authenticated role cannot SELECT the private Recycling
-- ledger tables. A tightly scoped SECURITY DEFINER is therefore required
-- to enforce the same closed-shift rule without breaking unrelated tenants.
-- It exposes no result, uses a fixed empty search_path, and EXECUTE is
-- not granted to anon/authenticated.
create or replace function public.recycling_guard_shift_closure()
returns trigger language plpgsql security definer
set search_path='' as $shiftclose$
declare
  v_count bigint;
  v_buy_count bigint;
  v_sell_count bigint;
  v_cash_in bigint;
  v_cash_out bigint;
  v_transfer_in bigint;
  v_transfer_out bigint;
  v_cash_net bigint;
  v_expected bigint;
begin
  if new.status <> 'closed' or old.status <> 'open' then return new; end if;
  select count(*),
    count(*) filter (where direction='buy'),
    count(*) filter (where direction='sell'),
    coalesce(sum(total_minor) filter(where direction='sell' and settlement='cash'),0),
    coalesce(sum(total_minor) filter(where direction='buy' and settlement='cash'),0),
    coalesce(sum(total_minor) filter(where direction='sell' and settlement='bank_transfer'),0),
    coalesce(sum(total_minor) filter(where direction='buy' and settlement='bank_transfer'),0)
  into v_count,v_buy_count,v_sell_count,v_cash_in,v_cash_out,
    v_transfer_in,v_transfer_out
  from public.recycling_transactions
  where tenant_id=new.tenant_id and branch_id=new.branch_id
    and shift_id=new.id and status='posted';
  v_cash_net := v_cash_in-v_cash_out;
  if v_count=0 then return new; end if;
  if exists (select 1 from public.orders
    where tenant_id=new.tenant_id and branch_id=new.branch_id
      and shift_id=new.id limit 1) then
    raise exception 'recycling_mixed_legacy_shift_requires_reconciliation';
  end if;
  if new.actual_cash is null or new.actual_cash<0 then
    raise exception 'recycling_shift_cash_count_required';
  end if;
  v_expected := pg_catalog.round(coalesce(old.opening_cash,0)*100)::bigint+v_cash_net;
  if v_expected<0 then raise exception 'recycling_shift_negative_expected_cash'; end if;
  new.expected_cash := v_expected::numeric/100;
  new.metadata := coalesce(new.metadata,'{}'::jsonb) ||
    pg_catalog.jsonb_build_object(
      'recycling_buy_count',v_buy_count,
      'recycling_sell_count',v_sell_count,
      'recycling_cash_in_minor',v_cash_in,
      'recycling_cash_out_minor',v_cash_out,
      'recycling_cash_net_minor',v_cash_net,
      'recycling_transfer_in_minor',v_transfer_in,
      'recycling_transfer_out_minor',v_transfer_out,
      'recycling_expected_cash_minor',v_expected,
      'recycling_cash_count_reconciled',
        pg_catalog.round(new.actual_cash*100)::bigint=v_expected
    );
  return new;
end;
$shiftclose$;
revoke all on function public.recycling_guard_shift_closure()
  from public,anon,authenticated;
grant execute on function public.recycling_guard_shift_closure() to service_role;
create trigger recycling_cash_shift_close_guard
before update of status on public.shifts
for each row
execute function public.recycling_guard_shift_closure();

-- Release plan:
-- 1. Run draft on isolated staging and inspect RLS/function grants.
-- 2. Test concurrent/duplicate request_id, insufficient stock and rollback.
-- 3. Confirm staff membership, shift and trial/lock gates.
-- 4. Map and post balanced entries to finance_accounting_* with approval and
--    source-document audit. No VAT/invoice until legal verification.
-- 5. Only then promote a verified migration, run advisors and allow production.


-- PHASE 3: accountant-approved Finance posting
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
  if v_debits <> (v_tx.total_minor +
       (case when v_tx.direction='sell' then v_tx.cogs_minor else 0 end))
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
$fn$;

revoke all on function public.recycling_finance_post_transaction(uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.recycling_finance_post_transaction(uuid,uuid,uuid,uuid)
  to service_role;

-- NOTE: Before staging release, generate a canonical migration, test this RPC
-- with cashier!=accountant, a locked period and every account_type mismatch.
-- This draft must be disabled when the store is VAT-registered unless the
-- merchant's verified VAT workflow is implemented.

-- PHASE 4: limited same-shift VOID of unposted documents
create or replace function public.recycling_void_unposted_transaction(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_transaction_id uuid,
  p_approver_user_id uuid,
  p_void_request_id uuid,
  p_reason text,
  p_stock_verified boolean,
  p_cash_returned_confirmed boolean
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $void$
declare
  v_original public.recycling_transactions%rowtype;
  v_shift public.shifts%rowtype;
  v_snapshot record;
  v_stock record;
  v_count integer;
  v_opening_cash_minor bigint;
  v_cash_net_minor bigint;
begin
  if p_tenant_id is null or p_branch_id is null or
     p_transaction_id is null or p_approver_user_id is null or
     p_void_request_id is null then
    raise exception 'recycling_void_identity_required';
  end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 500 then
    raise exception 'recycling_void_reason_required';
  end if;
  if p_stock_verified is distinct from true then
    raise exception 'recycling_void_stock_confirmation_required';
  end if;

  -- First resolve the shift without holding the transaction row lock.
  -- Both ordinary posting and VOID acquire the shift row lock FIRST,
  -- guaranteeing a consistent lock order with close-shift operations.
  select * into v_original from public.recycling_transactions
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and id=p_transaction_id;
  if not found then raise exception 'recycling_void_original_missing'; end if;

  select * into v_shift from public.shifts
    where id=v_original.shift_id and tenant_id=p_tenant_id
      and branch_id=p_branch_id for update;
  if not found or v_shift.status<>'open' then
    raise exception 'recycling_void_shift_already_closed';
  end if;

  select * into v_original from public.recycling_transactions
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and id=p_transaction_id for update;
  if not found then raise exception 'recycling_void_original_missing'; end if;

  if v_original.status='voided' then
    if v_original.void_request_id=p_void_request_id and
       v_original.voided_by=p_approver_user_id and
       v_original.void_reason=btrim(p_reason) and
       v_original.void_stock_confirmed is true and
       v_original.void_cash_confirmed is not distinct from
         p_cash_returned_confirmed then
      return pg_catalog.jsonb_build_object(
        'id',v_original.id,'receipt_no',v_original.receipt_no,
        'status','voided','idempotent',true);
    end if;
    raise exception 'recycling_void_already_voided';
  end if;
  if v_original.status<>'posted' then raise exception 'recycling_void_invalid_status'; end if;
  if v_original.finance_document_id is not null then
    raise exception 'recycling_void_finance_already_posted';
  end if;
  if v_original.settlement='bank_transfer' then
    raise exception 'recycling_void_bank_reversal_requires_finance';
  end if;
  if v_original.settlement='cash' and
     p_cash_returned_confirmed is distinct from true then
    raise exception 'recycling_void_cash_confirmation_required';
  end if;
  if p_approver_user_id=v_original.operator_user_id then
    raise exception 'recycling_void_self_approval_forbidden';
  end if;

  -- Check that approver is an independently authenticated, currently
  -- active manager/owner/accountant of exactly this tenant and branch.
  if not exists (
    select 1 from public.user_branch_roles r
      join public.users_profiles u on u.id=r.user_id
      join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id
      join public.tenants t on t.id=r.tenant_id
    where r.user_id=p_approver_user_id and r.tenant_id=p_tenant_id
      and r.branch_id=p_branch_id and r.role::text in ('owner','manager','accountant')
      and u.is_active=true and b.is_active=true and t.is_active=true
  ) then raise exception 'recycling_void_approver_forbidden'; end if;

  select count(*) into v_count from public.recycling_transaction_lines
  where tenant_id=p_tenant_id and branch_id=p_branch_id
    and transaction_id=v_original.id;
  if v_count<1 then raise exception 'recycling_void_lines_missing'; end if;

  -- DISTINCT ON picks the earliest original line for each material.
  -- Its before-snapshot represents the stock state to restore.
  -- The original may have repeated SKUs; all their writes share one
  -- transaction id in last_transaction_id.
  for v_snapshot in
    select distinct on (product_id)
      product_id,stock_qty_before,stock_cost_before_minor,
      stock_last_transaction_before
    from public.recycling_transaction_lines
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and transaction_id=v_original.id
    order by product_id,line_no
  loop
    select quantity_base,carrying_cost_minor,last_transaction_id
      into v_stock from public.recycling_stock_balances
      where tenant_id=p_tenant_id and branch_id=p_branch_id
        and product_id=v_snapshot.product_id for update;
    if not found or v_stock.last_transaction_id is distinct from v_original.id then
      raise exception 'recycling_void_material_has_later_movement';
    end if;
    update public.recycling_stock_balances set
      quantity_base=v_snapshot.stock_qty_before,
      carrying_cost_minor=v_snapshot.stock_cost_before_minor,
      last_transaction_id=v_snapshot.stock_last_transaction_before,
      updated_at=now()
    where tenant_id=p_tenant_id and branch_id=p_branch_id
      and product_id=v_snapshot.product_id;
  end loop;

  -- Existing posted subledger rows remain immutable evidence of the
  -- original receipt. Reports must exclude voided transactions from totals.
  -- Finance GL posting checks status='posted' under the same row lock.
  update public.recycling_transactions set
    status='voided',
    voided_at=now(),
    voided_by=p_approver_user_id,
    void_reason=btrim(p_reason),
    void_request_id=p_void_request_id,
    void_stock_confirmed=true,
    void_cash_confirmed=p_cash_returned_confirmed
  where id=v_original.id and tenant_id=p_tenant_id and branch_id=p_branch_id;

  -- If cancelling an earlier CASH sale requires returning cash to buyer,
  -- prevent a negative drawer. By holding shift lock we serialize with
  -- all buy/sell postings and any concurrent close-shift.
  if v_original.settlement='cash' then
    v_opening_cash_minor := pg_catalog.round(
      coalesce(v_shift.opening_cash,0)*100)::bigint;
    select coalesce(sum(
      case when direction='sell' then total_minor else -total_minor end),0)
      into v_cash_net_minor
      from public.recycling_transactions
      where tenant_id=p_tenant_id and branch_id=p_branch_id
        and shift_id=v_shift.id and status='posted' and settlement='cash';
    if v_opening_cash_minor+v_cash_net_minor<0 then
      raise exception 'recycling_void_cash_drawer_insufficient';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'id',v_original.id,'receipt_no',v_original.receipt_no,
    'status','voided','idempotent',false);
end;
$void$;

revoke all on function public.recycling_void_unposted_transaction(
  uuid,uuid,uuid,uuid,uuid,text,boolean,boolean
) from public,anon,authenticated;
grant execute on function public.recycling_void_unposted_transaction(
  uuid,uuid,uuid,uuid,uuid,text,boolean,boolean
) to service_role;

COMMIT;
