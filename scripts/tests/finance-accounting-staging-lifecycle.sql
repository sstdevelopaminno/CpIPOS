\set ON_ERROR_STOP on
-- Additional receivables/payables, bank transfer and period-lock acceptance.
DO $test$
DECLARE
  t uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  b uuid := '11111111-1111-4111-8111-111111111111';
  maker uuid := '33333333-3333-4333-8333-333333333333';
  approver uuid := '44444444-4444-4444-8444-444444444444';
  cash uuid;
  bank uuid;
  revenue uuid;
  expense uuid;
  liability uuid;
  invoice uuid;
  bill uuid;
  receipt uuid;
  payment uuid;
  overpaid uuid;
  pending uuid;
  r jsonb;
  n integer;
BEGIN
  SELECT id INTO cash FROM public.finance_accounting_chart WHERE tenant_id=t AND account_code='1000';
  SELECT id INTO bank FROM public.finance_accounting_chart WHERE tenant_id=t AND account_code='1010';
  SELECT id INTO revenue FROM public.finance_accounting_chart WHERE tenant_id=t AND account_code='4000';
  PERFORM public.finance_accounting_create_account(t,b,maker,'2100','Accounts payable','liability');
  PERFORM public.finance_accounting_create_account(t,b,maker,'5100','Expense','expense');
  SELECT id INTO liability FROM public.finance_accounting_chart WHERE tenant_id=t AND account_code='2100';
  SELECT id INTO expense FROM public.finance_accounting_chart WHERE tenant_id=t AND account_code='5100';

  r:=public.finance_accounting_create_document(t,b,maker,
    'sales_invoice','TEST-AR-1','Test Buyer','2026-11-18','2026-12-01','THB',
    '[{"description":"Test charge","quantity":1,"unitMinor":10000,"lineMinor":10000}]'::jsonb,
    'aaaa1111-0000-4000-8000-000000000001');
  invoice:=(r->>'id')::uuid;
  PERFORM public.finance_accounting_transition_document(t,b,maker,invoice,'submit',1);
  PERFORM public.finance_accounting_transition_document(t,b,approver,invoice,'approve',2);
  PERFORM public.finance_accounting_transition_document(t,b,approver,invoice,'issue',3);
  PERFORM public.finance_accounting_post_document(t,b,approver,invoice,cash,revenue);

  r:=public.finance_accounting_create_document(t,b,maker,
    'receipt_voucher','TEST-RCPT-1','Test Buyer','2026-11-18',NULL,'THB',
    '[{"description":"Partial collection","quantity":1,"unitMinor":4000,"lineMinor":4000}]'::jsonb,
    'aaaa1111-0000-4000-8000-000000000002',invoice,'PAYMENT-TEST-0001','bank_transfer');
  receipt:=(r->>'id')::uuid;
  PERFORM public.finance_accounting_transition_document(t,b,maker,receipt,'submit',1);
  PERFORM public.finance_accounting_transition_document(t,b,approver,receipt,'approve',2);
  PERFORM public.finance_accounting_transition_document(t,b,approver,receipt,'issue',3);
  PERFORM public.finance_accounting_post_document(t,b,approver,receipt,bank,cash);
  SELECT sum(amount_minor) INTO n FROM public.finance_accounting_allocations
    WHERE tenant_id=t AND branch_id=b AND source_document_id=invoice;
  IF n<>4000 THEN RAISE EXCEPTION 'STAGING FAIL: AR allocation % expected 4000',n; END IF;

  r:=public.finance_accounting_create_document(t,b,maker,
    'receipt_voucher','TEST-RCPT-OVER','Test Buyer','2026-11-18',NULL,'THB',
    '[{"description":"Overpayment test","quantity":1,"unitMinor":7000,"lineMinor":7000}]'::jsonb,
    'aaaa1111-0000-4000-8000-000000000003',invoice,'PAYMENT-TEST-0002','bank_transfer');
  overpaid:=(r->>'id')::uuid;
  PERFORM public.finance_accounting_transition_document(t,b,maker,overpaid,'submit',1);
  PERFORM public.finance_accounting_transition_document(t,b,approver,overpaid,'approve',2);
  PERFORM public.finance_accounting_transition_document(t,b,approver,overpaid,'issue',3);
  BEGIN
    PERFORM public.finance_accounting_post_document(t,b,approver,overpaid,bank,cash);
    RAISE EXCEPTION 'test_expected_error_not_raised';
  EXCEPTION WHEN others THEN
    IF SQLERRM='test_expected_error_not_raised' OR
       position('finance_accounting_overallocation' IN SQLERRM)=0 THEN RAISE; END IF;
  END;
  SELECT count(*) INTO n FROM public.finance_accounting_journals WHERE document_id=overpaid;
  IF n<>0 THEN RAISE EXCEPTION 'STAGING FAIL: overpaid journal was posted'; END IF;

  r:=public.finance_accounting_create_document(t,b,maker,
    'supplier_bill','TEST-AP-1','Test Supplier','2026-11-18','2026-12-01','THB',
    '[{"description":"Supplier bill","quantity":1,"unitMinor":5000,"lineMinor":5000}]'::jsonb,
    'aaaa2222-0000-4000-8000-000000000001');
  bill:=(r->>'id')::uuid;
  PERFORM public.finance_accounting_transition_document(t,b,maker,bill,'submit',1);
  PERFORM public.finance_accounting_transition_document(t,b,approver,bill,'approve',2);
  PERFORM public.finance_accounting_transition_document(t,b,approver,bill,'issue',3);
  PERFORM public.finance_accounting_post_document(t,b,approver,bill,expense,liability);
  r:=public.finance_accounting_create_document(t,b,maker,
    'payment_voucher','TEST-PAY-1','Test Supplier','2026-11-18',NULL,'THB',
    '[{"description":"Partial supplier payment","quantity":1,"unitMinor":2000,"lineMinor":2000}]'::jsonb,
    'aaaa2222-0000-4000-8000-000000000002',bill,'BANK-TRANSFER-TEST-0001','bank_transfer');
  payment:=(r->>'id')::uuid;
  PERFORM public.finance_accounting_transition_document(t,b,maker,payment,'submit',1);
  PERFORM public.finance_accounting_transition_document(t,b,approver,payment,'approve',2);
  PERFORM public.finance_accounting_transition_document(t,b,approver,payment,'issue',3);
  PERFORM public.finance_accounting_post_document(t,b,approver,payment,liability,cash);
  SELECT sum(amount_minor) INTO n FROM public.finance_accounting_allocations
    WHERE tenant_id=t AND branch_id=b AND source_document_id=bill;
  IF n<>2000 THEN RAISE EXCEPTION 'STAGING FAIL: AP allocation % expected 2000',n; END IF;

  -- Monthly lock must prevent creation of new posted journal, but preserve draft.
  r:=public.finance_accounting_create_document(t,b,maker,
    'expense_voucher','TEST-LOCK-1','Test Costs','2026-11-18',NULL,'THB',
    '[{"description":"Locked expense","quantity":1,"unitMinor":1234,"lineMinor":1234}]'::jsonb,
    'aaaa3333-0000-4000-8000-000000000001',NULL,'EXPENSE-PROOF-0001','cash_count');
  pending:=(r->>'id')::uuid;
  PERFORM public.finance_accounting_transition_document(t,b,maker,pending,'submit',1);
  PERFORM public.finance_accounting_transition_document(t,b,approver,pending,'approve',2);
  PERFORM public.finance_accounting_transition_document(t,b,approver,pending,'issue',3);
  INSERT INTO public.finance_accounting_periods(tenant_id,branch_id,period_month,locked_at,locked_by)
    VALUES(t,b,'2026-11-01',now(),approver);
  BEGIN
    PERFORM public.finance_accounting_post_document(t,b,approver,pending,expense,cash);
    RAISE EXCEPTION 'test_expected_error_not_raised';
  EXCEPTION WHEN others THEN
    IF SQLERRM='test_expected_error_not_raised' OR
       position('finance_accounting_period_locked' IN SQLERRM)=0 THEN RAISE; END IF;
  END;

  RAISE NOTICE 'STAGING PASS: AR/AP allocations, overpayment fail-closed, approval, monthly period lock';
END;
$test$;
