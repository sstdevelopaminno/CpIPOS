-- Run only in a disposable PostgreSQL 16 database AFTER the main UAT.
-- Validates non-destructive VOID before Finance GL. No real accounts/payments.
do $voidtest$
declare
  v_t uuid := '11111111-1111-4111-8111-111111111111';
  v_b uuid := '22222222-2222-4222-8222-222222222222';
  v_cashier uuid := '33333333-3333-4333-8333-333333333333';
  v_accountant uuid := '44444444-4444-4444-8444-444444444444';
  v_shift uuid := '99999999-9999-4999-8999-999999999991';
  v_product uuid := '55555555-5555-4555-8555-555555555555';
  v_buy uuid;
  v_sell uuid;
  v_bank uuid;
  v_gl uuid;
  v_qty_before numeric;
  v_cost_before bigint;
  v_marker_before uuid;
  v_qty_after numeric;
  v_cost_after bigint;
  v_marker_after uuid;
  v_res jsonb;
  v_count bigint;
begin
  if has_function_privilege('anon',
      'public.recycling_void_unposted_transaction(uuid,uuid,uuid,uuid,uuid,text,boolean,boolean)',
      'EXECUTE') then
    raise exception 'UAT_VOID_ROLE_EXPOSED';
  end if;
  insert into public.shifts(id,tenant_id,branch_id,opening_cash,status)
    values(v_shift,v_t,v_b,200,'open');
  select quantity_base,carrying_cost_minor,last_transaction_id
    into v_qty_before,v_cost_before,v_marker_before
    from public.recycling_stock_balances where product_id=v_product;

  v_res:=public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
    '01010101-0101-4101-8101-010101010101','buy','credit','Credit test seller',
    jsonb_build_array(jsonb_build_object('product_id',v_product,
      'quantity',1,'unit','kg','expected_price',8.25)));
  v_buy:=(v_res->>'id')::uuid;
  begin
    perform public.recycling_void_unposted_transaction(
      v_t,v_b,v_buy,v_cashier,
      '02020202-0202-4202-8202-020202020202',
      'Test void without independent approval',true,false);
    raise exception 'UAT_MISSING_VOID_SELF_APPROVAL';
  exception when others then
    if position('recycling_void_self_approval_forbidden' in sqlerrm)=0 then raise; end if;
  end;

  v_res:=public.recycling_void_unposted_transaction(
      v_t,v_b,v_buy,v_accountant,
      '03030303-0303-4303-8303-030303030303',
      'Approved supplier credit VOID after stock verification',true,false);
  if v_res->>'status'<>'voided' or v_res->>'idempotent'<>'false' then
    raise exception 'UAT_CREDIT_VOID_FAILED: %',v_res; end if;
  select quantity_base,carrying_cost_minor,last_transaction_id
    into v_qty_after,v_cost_after,v_marker_after
    from public.recycling_stock_balances where product_id=v_product;
  if v_qty_after<>v_qty_before or v_cost_after<>v_cost_before or
     v_marker_after is distinct from v_marker_before then
    raise exception 'UAT_VOID_FAILED_STOCK_RESTORE'; end if;

  v_res:=public.recycling_void_unposted_transaction(
      v_t,v_b,v_buy,v_accountant,
      '03030303-0303-4303-8303-030303030303',
      'Approved supplier credit VOID after stock verification',true,false);
  if v_res->>'idempotent'<>'true' then
    raise exception 'UAT_VOID_IDEMPOTENCY_FAILED'; end if;
  begin
    perform public.recycling_void_unposted_transaction(
      v_t,v_b,v_buy,v_accountant,
      '04040404-0404-4404-8404-040404040404',
      'Second invalid attempt to cancel same transaction',true,false);
    raise exception 'UAT_MISSING_DOUBLE_VOID_REJECTION';
  exception when others then
    if position('recycling_void_already_voided' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform public.recycling_finance_post_transaction(v_t,v_b,v_buy,v_accountant);
    raise exception 'UAT_VOID_FINANCE_POST_NOT_BLOCKED';
  exception when others then
    if position('recycling_finance_transaction_not_found' in sqlerrm)=0 then raise; end if;
  end;

  -- A later material movement invalidates an earlier original stock snapshot.
  v_res:=public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
    '05050505-0505-4505-8505-050505050505','buy','credit','Preceding supplier',
    jsonb_build_array(jsonb_build_object('product_id',v_product,
      'quantity',1,'unit','kg','expected_price',8.25)));
  v_buy:=(v_res->>'id')::uuid;
  v_res:=public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
    '06060606-0606-4606-8606-060606060606','sell','credit','Subsequent customer',
    jsonb_build_array(jsonb_build_object('product_id',v_product,
      'quantity',0.5,'unit','kg','expected_price',10)));
  v_sell:=(v_res->>'id')::uuid;
  begin
    perform public.recycling_void_unposted_transaction(
      v_t,v_b,v_buy,v_accountant,'07070707-0707-4707-8707-070707070707',
      'Cannot void a previous purchase after a later sale',true,false);
    raise exception 'UAT_MISSING_LAST_MOVEMENT_GUARD';
  exception when others then
    if position('recycling_void_material_has_later_movement' in sqlerrm)=0 then raise; end if;
  end;

  -- Cash sales: approver must verify both actual cash refund and stock.
  begin
    perform public.recycling_void_unposted_transaction(
      v_t,v_b,v_sell,v_accountant,'08080808-0808-4808-8808-080808080808',
      'Attempt without required cash confirmation',true,false);
    -- The sale was credit, so false is acceptable; this is NOT a cash sale.
  exception when others then
    raise exception 'UAT_CREDIT_VOID_SHOULD_NOT_REQUIRE_CASH: %',sqlerrm;
  end;

  v_res:=public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
    '09090909-0909-4909-8909-090909090909','buy','cash','Cash supplier',
    jsonb_build_array(jsonb_build_object('product_id',v_product,
      'quantity',1,'unit','kg','expected_price',8.25)));
  v_buy:=(v_res->>'id')::uuid;
  begin
    perform public.recycling_void_unposted_transaction(
      v_t,v_b,v_buy,v_accountant,'10101010-1010-4101-8101-101010101010',
      'Cash purchase without refund confirmation',true,false);
    raise exception 'UAT_MISSING_CASH_CONFIRMATION';
  exception when others then
    if position('recycling_void_cash_confirmation_required' in sqlerrm)=0 then raise; end if;
  end;
  v_res:=public.recycling_void_unposted_transaction(
      v_t,v_b,v_buy,v_accountant,'11111111-1111-4111-8111-111111111112',
      'Seller repaid cash and returned material was inspected',true,true);
  if v_res->>'status'<>'voided' then raise exception 'UAT_CASH_BUY_VOID_FAILED'; end if;

  v_res:=public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
    '12121212-1212-4212-8212-121212121212','sell','cash','Cash wholesale buyer',
    jsonb_build_array(jsonb_build_object('product_id',v_product,
      'quantity',0.5,'unit','kg','expected_price',10)));
  v_sell:=(v_res->>'id')::uuid;
  v_res:=public.recycling_void_unposted_transaction(
      v_t,v_b,v_sell,v_accountant,'13131313-1313-4313-8313-131313131313',
      'Customer refunded in cash and materials returned',true,true);
  if v_res->>'status'<>'voided' then raise exception 'UAT_CASH_SELL_VOID_FAILED'; end if;

  select count(*) into v_count from public.recycling_transactions
  where tenant_id=v_t and branch_id=v_b and shift_id=v_shift and status='voided';
  if v_count<>4 then
    raise exception 'UAT_VOID_AUDIT_COUNT_FAILED: %',v_count; end if;
  if (select count(*) from public.recycling_accounting_entries
      where transaction_id=v_sell)=0 then
    raise exception 'UAT_VOID_ERASED_SUBLEDGER_AUDIT'; end if;
  if (select count(*) from public.recycling_transactions where status='voided' and
      (voided_by is null or length(void_reason)<10))>0 then
    raise exception 'UAT_VOID_AUDIT_FIELDS_MISSING'; end if;

  v_res:=public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
    '14141414-1414-4414-8414-141414141414','buy','bank_transfer','Bank paid supplier',
    jsonb_build_array(jsonb_build_object('product_id',v_product,
      'quantity',1,'unit','kg','expected_price',8.25)));
  v_bank:=(v_res->>'id')::uuid;
  begin
    perform public.recycling_void_unposted_transaction(
      v_t,v_b,v_bank,v_accountant,'15151515-1515-4515-8515-151515151515',
      'Bank reversal without verified bank reference',true,false);
    raise exception 'UAT_MISSING_BANK_REVERSAL_BLOCK';
  exception when others then
    if position('recycling_void_bank_reversal_requires_finance' in sqlerrm)=0 then raise; end if;
  end;

  v_res:=public.recycling_post_transaction(v_t,v_b,v_shift,v_cashier,
    '16161616-1616-4616-8616-161616161616','buy','credit','GL accountant supplier',
    jsonb_build_array(jsonb_build_object('product_id',v_product,
      'quantity',1,'unit','kg','expected_price',8.25)));
  v_gl:=(v_res->>'id')::uuid;
  v_res:=public.recycling_finance_post_transaction(v_t,v_b,v_gl,v_accountant);
  if v_res->>'posted'<>'true' then raise exception 'UAT_VOID_FINANCE_TEST_FAILED'; end if;
  begin
    perform public.recycling_void_unposted_transaction(
      v_t,v_b,v_gl,v_accountant,'17171717-1717-4717-8717-171717171717',
      'Cannot void a posted Finance inventory document',true,false);
    raise exception 'UAT_MISSING_FINANCE_POSTED_VOID_REJECTION';
  exception when others then
    if position('recycling_void_finance_already_posted' in sqlerrm)=0 then raise; end if;
  end;

  -- After closing a shift, no reverse adjustment can silently reopen
  -- already reconciled cash/stock. A separate audited Finance workflow
  -- is required and intentionally outside this limited VOID function.
  update public.shifts set status='closed',actual_cash=200,
    expected_cash=999 where id=v_shift;
  begin
    perform public.recycling_void_unposted_transaction(
      v_t,v_b,v_gl,v_accountant,'18181818-1818-4818-8818-181818181818',
      'No backdating into a closed financial shift',true,false);
    raise exception 'UAT_MISSING_CLOSED_SHIFT_VOID_REJECTION';
  exception when others then
    if position('recycling_void_shift_already_closed' in sqlerrm)=0 then raise; end if;
  end;

  raise notice 'RECYCLING_VOID_POSTGRES_UAT_SUCCESS: permissions, audit, cash/credit, idempotency, GL-post, later stock, bank, closed shift';
end;
$voidtest$;
