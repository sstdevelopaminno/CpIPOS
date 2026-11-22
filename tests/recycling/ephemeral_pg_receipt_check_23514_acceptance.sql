-- Disposable PostgreSQL 16 test. Synthetic identities, prices, and money ONLY.
-- Regression: after short receipt-number release, a real 3 kg purchase for
-- 3.55 THB/kg must atomically post RCY-0004 for 10.65 THB, and a sale
-- must get the next number while retaining cash and stock invariants.
DO $recycling_receipt_23514$
DECLARE
  v_t uuid := '11111111-1111-4111-8111-111111111111';
  v_b uuid := '22222222-2222-4222-8222-222222222222';
  v_cashier uuid := '33333333-3333-4333-8333-333333333333';
  v_product uuid := '55555555-5555-4555-8555-555555555555';
  v_shift uuid := '81818181-8181-4818-8818-818181818181';
  v_buy jsonb;
  v_sell jsonb;
  v_before numeric;
  v_after numeric;
  v_legacy_count integer;
  v_constraint text;
  v_docs_before integer;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_constraint
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid='public.recycling_transactions'::regclass
      AND c.conname='recycling_transactions_receipt_no_check';
  IF v_constraint IS NULL OR position('length(receipt_no) >= 8' in v_constraint)=0
    OR position('length(receipt_no) <= 90' in v_constraint)=0
  THEN
    RAISE EXCEPTION 'UAT_23514_RECEIPT_CHECK_8_TO_90_NOT_INSTALLED: %',v_constraint;
  END IF;

  SELECT count(*) INTO v_docs_before FROM public.recycling_transactions;
  SELECT count(*) INTO v_legacy_count FROM public.recycling_transactions
    WHERE receipt_no ~ '^RCY-[BS]-[0-9]{8}-[0-9a-f]{12}$';
  IF v_legacy_count<1 THEN RAISE EXCEPTION 'UAT_23514_LEGACY_RECEIPT_MISSING'; END IF;

  -- A new fake shift is necessary because previous integration tests correctly
  -- closed their own fake shift. No real shop / tenant / cash is used here.
  INSERT INTO public.shifts(id,tenant_id,branch_id,opening_cash,status,metadata)
  VALUES(v_shift,v_t,v_b,5000.00,'open','{"business_shift_mode":"recycling_daily"}'::jsonb);

  SELECT quantity_base INTO v_before FROM public.recycling_stock_balances
    WHERE tenant_id=v_t AND branch_id=v_b AND product_id=v_product;
  IF v_before IS NULL THEN RAISE EXCEPTION 'UAT_23514_STOCK_FIXTURE_MISSING'; END IF;

  UPDATE public.products SET metadata=pg_catalog.jsonb_set(
    metadata,'{recycling_buy_price}','3.55'::jsonb,true
  ) WHERE id=v_product AND tenant_id=v_t AND branch_id=v_b;
  SELECT public.recycling_post_transaction(
    v_t,v_b,v_shift,v_cashier,
    '91919191-9191-4919-8919-919191919191',
    'buy','cash','Synthetic recycling supplier',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'product_id',v_product,'quantity',3,'unit','kg','expected_price',3.55
    ))
  ) INTO v_buy;
  IF v_buy->>'receipt_no'<>'RCY-0004'
      OR (v_buy->>'total_minor')::bigint<>1065
      OR (SELECT count(*) FROM public.recycling_transaction_lines WHERE transaction_id=(v_buy->>'id')::uuid)<>1
  THEN RAISE EXCEPTION 'UAT_23514_BUY_POST_FAILED: %',v_buy; END IF;

  SELECT public.recycling_post_transaction(
    v_t,v_b,v_shift,v_cashier,
    '92929292-9292-4929-8929-929292929292',
    'sell','cash','Synthetic recycling customer',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'product_id',v_product,'quantity',1,'unit','kg','expected_price',10
    ))
  ) INTO v_sell;
  IF v_sell->>'receipt_no'<>'RCY-0005'
      OR (v_sell->>'total_minor')::bigint<>1000
  THEN RAISE EXCEPTION 'UAT_23514_SELL_POST_FAILED: %',v_sell; END IF;

  SELECT quantity_base INTO v_after FROM public.recycling_stock_balances
    WHERE tenant_id=v_t AND branch_id=v_b AND product_id=v_product;
  IF v_after<>v_before+2 THEN
    RAISE EXCEPTION 'UAT_23514_STOCK_MISMATCH: before %, after %',v_before,v_after;
  END IF;
  IF (SELECT sum(case when direction='sell' then total_minor else -total_minor end)
      FROM public.recycling_transactions WHERE shift_id=v_shift AND status='posted'
        AND settlement='cash')<>-65 THEN
    RAISE EXCEPTION 'UAT_23514_SHIFT_CASH_MISMATCH'; END IF;
  IF (SELECT last_number FROM public.recycling_receipt_counters WHERE tenant_id=v_t)<>5 THEN
    RAISE EXCEPTION 'UAT_23514_COUNTER_MISMATCH'; END IF;
  IF (SELECT count(*) FROM public.recycling_transactions)<>v_docs_before+2 THEN
    RAISE EXCEPTION 'UAT_23514_UNEXPECTED_BILL_COUNT'; END IF;
  IF (SELECT count(*) FROM public.recycling_transactions
      WHERE receipt_no ~ '^RCY-[BS]-[0-9]{8}-[0-9a-f]{12}$')<>v_legacy_count
  THEN RAISE EXCEPTION 'UAT_23514_LEGACY_RECEIPT_CHANGED'; END IF;

  RAISE NOTICE 'PASS: RCY-0004 purchase THB10.65, RCY-0005 sale, prior receipts preserved, cash/stock checks intact';
END;
$recycling_receipt_23514$;
