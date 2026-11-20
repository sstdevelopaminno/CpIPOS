-- Execute in a fresh isolated PostgreSQL 16 database. NEVER on Supabase Production.
-- Enforces real SQL function behavior with synthetic data and transaction tests.
set client_min_messages=warning;

do $uat$
declare
  v_t uuid := '11111111-1111-4111-8111-111111111111';
  v_b uuid := '22222222-2222-4222-8222-222222222222';
  v_cashier uuid := '33333333-3333-4333-8333-333333333333';
  v_accountant uuid := '44444444-4444-4444-8444-444444444444';
  v_shift uuid := '88888888-8888-4888-8888-888888888888';
  v_product uuid := '55555555-5555-4555-8555-555555555555';
  v_buy_id uuid;
  v_sell_id uuid;
  v_third_id uuid;
  v_res jsonb;
  v_ledger jsonb;
  v_qty numeric;
  v_value bigint;
  v_cogs bigint;
  v_count integer;
  v_check text;
begin
  if exists (
    select 1 from pg_catalog.pg_class c
    where c.relnamespace='public'::regnamespace
      and c.relname in ('recycling_stock_balances','recycling_transactions',
        'recycling_transaction_lines','recycling_accounting_entries')
      and not c.relrowsecurity
  ) then raise exception 'UAT_FAILED_RLS_DISABLED'; end if;

  if has_function_privilege('anon',
      'public.recycling_post_transaction(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb)',
      'EXECUTE') or
     has_function_privilege('authenticated',
      'public.recycling_finance_post_transaction(uuid,uuid,uuid,uuid)',
      'EXECUTE') then
    raise exception 'UAT_FAILED_PUBLIC_RECYCLING_RPC_EXPOSED';
  end if;

  v_res := public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
    '99999999-9999-4999-8999-999999999999','buy','cash',
    'Synthetic seller',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('product_id',v_product,
        'quantity',2.5,'unit','kg','expected_price',8.25)));
  v_buy_id := (v_res->>'id')::uuid;
  if (v_res->>'total_minor')::bigint<>2063 or
     v_res->>'idempotent'<>'false' or
     coalesce(v_res->>'receipt_no','') !~ '^RCY-B-[0-9]{8}-[a-f0-9]{12}$'
  then raise exception 'UAT_FAILED_BUY_RESULT: %',v_res; end if;

  select quantity_base,carrying_cost_minor into v_qty,v_value
    from public.recycling_stock_balances where product_id=v_product;
  if v_qty<>2.5 or v_value<>2063 then
    raise exception 'UAT_FAILED_BUY_INVENTORY'; end if;

  select count(*) into v_count from public.recycling_transaction_lines
    where transaction_id=v_buy_id and sku_snapshot='IRON001'
      and name_snapshot='เศษเหล็ก';
  if v_count<>1 then raise exception 'UAT_FAILED_PRODUCT_SNAPSHOT'; end if;

  v_res := public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
    '99999999-9999-4999-8999-999999999999','buy','cash',
    'Synthetic seller',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('product_id',v_product,
        'quantity',2.5,'unit','kg','expected_price',8.25)));
  if v_res->>'idempotent'<>'true' or (v_res->>'id')::uuid<>v_buy_id then
    raise exception 'UAT_FAILED_IDEMPOTENT_RETRY'; end if;

  begin
    perform public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
      '99999999-9999-4999-8999-999999999999','buy','cash',
      'Synthetic seller',
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('product_id',v_product,
          'quantity',3,'unit','kg','expected_price',8.25)));
    raise exception 'UAT_MISSING_REQUEST_KEY_CONFLICT';
  exception when others then
    if position('recycling_request_key_reused' in sqlerrm)=0 then raise; end if;
  end;

  v_res := public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','sell','cash',
    'Synthetic wholesale buyer',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('product_id',v_product,
        'quantity',1,'unit','kg','expected_price',10)));
  v_sell_id := (v_res->>'id')::uuid;
  if (v_res->>'total_minor')::bigint<>1000 or
     (v_res->>'cogs_minor')::bigint<>825 then
    raise exception 'UAT_FAILED_SALE_RESULT: %',v_res; end if;
  select quantity_base,carrying_cost_minor into v_qty,v_value
    from public.recycling_stock_balances where product_id=v_product;
  if v_qty<>1.5 or v_value<>1238 then
    raise exception 'UAT_FAILED_SALE_COGS_INVENTORY: qty % value %',v_qty,v_value; end if;

  -- Enforce strict atomicity: invalid or unstocked sale may not change
  -- inventory, create a new receipt or append accounting ledger rows.
  select count(*) into v_count from public.recycling_transactions;
  begin
    perform public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','sell','cash','Too much stock',
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('product_id',v_product,
          'quantity',2,'unit','kg','expected_price',10)));
    raise exception 'UAT_MISSING_INSUFFICIENT_STOCK';
  exception when others then
    if position('recycling_stock_insufficient' in sqlerrm)=0 then raise; end if;
  end;
  if (select count(*) from public.recycling_transactions)<>v_count then
    raise exception 'UAT_FAILED_FAILED_WRITE_NOT_ROLLED_BACK'; end if;

  begin
    perform public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc','sell','cash','Stale cart price',
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('product_id',v_product,
          'quantity',1,'unit','kg','expected_price',9)));
    raise exception 'UAT_MISSING_STALE_PRICE_REJECTION';
  exception when others then
    if position('recycling_price_changed_refresh_cart' in sqlerrm)=0 then raise; end if;
  end;

  v_ledger := public.recycling_finance_post_transaction(v_t,v_b,v_buy_id,v_accountant);
  if v_ledger->>'posted'<>'true' then raise exception 'UAT_FAILED_BUY_GL'; end if;
  v_ledger := public.recycling_finance_post_transaction(v_t,v_b,v_sell_id,v_accountant);
  if v_ledger->>'posted'<>'true' then raise exception 'UAT_FAILED_SELL_GL'; end if;
  v_ledger := public.recycling_finance_post_transaction(v_t,v_b,v_sell_id,v_accountant);
  if v_ledger->>'idempotent'<>'true' then raise exception 'UAT_FAILED_GL_IDEMPOTENCY'; end if;

  select count(*) into v_count from public.finance_accounting_journal_lines
    where journal_id=(v_ledger->>'journal_id')::uuid;
  if v_count<>4 then raise exception 'UAT_FAILED_GL_COGS_ENTRIES'; end if;

  if exists(
    select 1 from public.finance_accounting_journals
    where debit_total_minor<>credit_total_minor
  ) then raise exception 'UAT_FAILED_UNBALANCED_GL'; end if;

  if (select count(*) from public.finance_accounting_documents)<>2 or
     (select count(*) from public.recycling_transactions
       where finance_document_id is not null)<>2 then
    raise exception 'UAT_FAILED_FINANCE_DOCUMENT_LINKING'; end if;

  -- Immovable receipt content: editing today's material catalog must not
  -- rewrite historical receipts or the Finance source document reference.
  update public.products set name='ชื่อใหม่สำหรับสินค้าปัจจุบัน' where id=v_product;
  select name_snapshot into v_check from public.recycling_transaction_lines
    where transaction_id=v_buy_id and line_no=1;
  if v_check<>'เศษเหล็ก' then raise exception 'UAT_FAILED_RECEIPT_MUTABLE'; end if;

  -- A locked Finance month must block NEW GL posting, but must not erase
  -- already committed receipts or the historical subledger.
  v_res := public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd','buy','credit','Another supplier',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'product_id',v_product,'quantity',1,'unit','kg','expected_price',8.25)));
  v_third_id := (v_res->>'id')::uuid;

  insert into public.finance_accounting_periods(tenant_id,branch_id,period_month,locked_at)
    values(v_t,v_b,date_trunc('month',current_date)::date,now());
  begin
    perform public.recycling_finance_post_transaction(v_t,v_b,v_third_id,v_accountant);
    raise exception 'UAT_MISSING_PERIOD_LOCK';
  exception when others then
    if position('recycling_finance_period_locked' in sqlerrm)=0 then raise; end if;
  end;
  delete from public.finance_accounting_periods where tenant_id=v_t and branch_id=v_b;

  -- Expired trial prevents new inventory and money entries even when
  -- sales_modes.recycling remains true in contract metadata.
  update public.tenant_data_lifecycle set trial_expires_at=now()-interval '1 day'
    where tenant_id=v_t;
  begin
    perform public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','buy','cash','Expired',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'product_id',v_product,'quantity',1,'unit','kg','expected_price',8.25)));
    raise exception 'UAT_MISSING_TRIAL_EXPIRY_GATE';
  exception when others then
    if position('recycling_subscription_inactive' in sqlerrm)=0 then raise; end if;
  end;
  update public.tenant_data_lifecycle set trial_expires_at=now()+interval '7 days'
    where tenant_id=v_t;

  raise notice 'RECYCLING_POSTGRES_ACCEPTANCE_SUCCESS: stock, satang, GL, finance approval, permissions, audit, receipts, idempotency, locked period';
end;
$uat$;

select 'PASS' as result,
  (select count(*) from public.recycling_transactions) as posted_receipts,
  (select count(*) from public.finance_accounting_journals) as approved_gl_journals;
