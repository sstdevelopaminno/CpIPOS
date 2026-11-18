\set ON_ERROR_STOP on
-- Disposable CI staging; all IDs, cash, and invoices are fictitious.
INSERT INTO public.tenants(id) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.branches(id,tenant_id) VALUES
 ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('11111111-1111-4111-8111-111111111112','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
 ('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.users_profiles(id) VALUES
 ('33333333-3333-4333-8333-333333333333'),
 ('44444444-4444-4444-8444-444444444444'),
 ('55555555-5555-4555-8555-555555555555');
INSERT INTO public.user_branch_roles(tenant_id,branch_id,user_id,role) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','accountant'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','accountant'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111112','33333333-3333-4333-8333-333333333333','accountant'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555','accountant');

DO $test$
DECLARE
  t uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  b uuid := '11111111-1111-4111-8111-111111111111';
  b2 uuid := '11111111-1111-4111-8111-111111111112';
  t2 uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  rb uuid := '22222222-2222-4222-8222-222222222222';
  maker uuid := '33333333-3333-4333-8333-333333333333';
  reviewer uuid := '44444444-4444-4444-8444-444444444444';
  outsider uuid := '55555555-5555-4555-8555-555555555555';
  first jsonb;
  again jsonb;
  other jsonb;
  doc uuid;
  journal jsonb;
  a_cash uuid;
  a_bank uuid;
  a_income uuid;
  n integer;
BEGIN
  IF has_function_privilege('anon','public.finance_accounting_create_other_income(uuid,uuid,uuid,uuid,date,text,numeric,bigint,text,text,text,text)','EXECUTE') OR
     has_function_privilege('authenticated','public.finance_accounting_post_document(uuid,uuid,uuid,uuid,uuid,uuid)','EXECUTE') OR
     has_table_privilege('authenticated','public.finance_accounting_documents','SELECT') THEN
    RAISE EXCEPTION 'STAGING FAIL: public roles can access accounting RPC/table';
  END IF;
  IF NOT has_function_privilege('service_role','public.finance_accounting_create_other_income(uuid,uuid,uuid,uuid,date,text,numeric,bigint,text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'STAGING FAIL: service-role RPC unavailable';
  END IF;

  BEGIN
    PERFORM public.finance_accounting_create_other_income(t,b,outsider,
      'aaaaaaaa-0000-4000-8000-000000000001','2026-11-18','THB',1,100,'cash');
    RAISE EXCEPTION 'test_expected_error_not_raised';
  EXCEPTION WHEN others THEN
    IF SQLERRM='test_expected_error_not_raised' OR
      position('finance_accounting_actor_forbidden' IN SQLERRM)=0 THEN RAISE; END IF;
  END;

  first:=public.finance_accounting_create_other_income(t,b,maker,
    'aaaaaaaa-0000-4000-8000-000000000002','2026-11-18','THB',3,1234,'transfer',
    'Synthetic non-POS income',NULL,NULL);
  again:=public.finance_accounting_create_other_income(t,b,maker,
    'aaaaaaaa-0000-4000-8000-000000000002','2026-11-18','THB',3,1234,'transfer',
    'Synthetic non-POS income',NULL,NULL);
  IF first->>'number'<>'OIN-2026-000001'
     OR (first->>'amountMinor')::bigint<>3702
     OR first->>'id'<>again->>'id'
     OR (again->>'created')::boolean THEN
    RAISE EXCEPTION 'STAGING FAIL: manual income sequence or retry: %, %',first,again;
  END IF;
  doc:=(first->>'id')::uuid;
  SELECT count(*) INTO n FROM public.finance_accounting_documents WHERE tenant_id=t AND request_key='aaaaaaaa-0000-4000-8000-000000000002';
  IF n<>1 THEN RAISE EXCEPTION 'STAGING FAIL: duplicate retry created second record'; END IF;

  BEGIN
    PERFORM public.finance_accounting_create_other_income(t,b,maker,
      'aaaaaaaa-0000-4000-8000-000000000002','2026-11-18','THB',4,1234,'transfer','Synthetic non-POS income');
    RAISE EXCEPTION 'test_expected_error_not_raised';
  EXCEPTION WHEN others THEN
    IF SQLERRM='test_expected_error_not_raised' OR
      position('finance_accounting_idempotency_conflict' IN SQLERRM)=0 THEN RAISE; END IF;
  END;

  other:=public.finance_accounting_create_other_income(t,b2,maker,
    'aaaaaaaa-0000-4000-8000-000000000003','2026-11-18','THB',1,100,'cash');
  IF other->>'number'<>'OIN-2026-000001' THEN
    RAISE EXCEPTION 'STAGING FAIL: same-tenant other-branch sequence %',other;
  END IF;
  other:=public.finance_accounting_create_other_income(t2,rb,outsider,
    'aaaaaaaa-0000-4000-8000-000000000004','2026-11-18','THB',1,100,'cash');
  IF other->>'number'<>'OIN-2026-000001' THEN
    RAISE EXCEPTION 'STAGING FAIL: cross-tenant sequence %',other;
  END IF;

  PERFORM public.finance_accounting_create_account(t,b,maker,'1000','Synthetic Cash','asset');
  PERFORM public.finance_accounting_create_account(t,b,maker,'1010','Synthetic Bank','asset');
  PERFORM public.finance_accounting_create_account(t,b,maker,'4000','Synthetic Revenue','income');
  SELECT id INTO a_cash FROM public.finance_accounting_chart WHERE tenant_id=t AND account_code='1000';
  SELECT id INTO a_bank FROM public.finance_accounting_chart WHERE tenant_id=t AND account_code='1010';
  SELECT id INTO a_income FROM public.finance_accounting_chart WHERE tenant_id=t AND account_code='4000';
  IF a_cash IS NULL OR a_bank IS NULL OR a_income IS NULL THEN
    RAISE EXCEPTION 'STAGING FAIL: chart of accounts'; END IF;

  PERFORM public.finance_accounting_transition_document(t,b,maker,doc,'submit',1,'');
  BEGIN
    PERFORM public.finance_accounting_transition_document(t,b,maker,doc,'approve',2,'');
    RAISE EXCEPTION 'test_expected_error_not_raised';
  EXCEPTION WHEN others THEN
    IF SQLERRM='test_expected_error_not_raised' OR
      position('finance_accounting_self_approval_forbidden' IN SQLERRM)=0 THEN RAISE; END IF;
  END;
  PERFORM public.finance_accounting_transition_document(t,b,reviewer,doc,'approve',2,'');
  PERFORM public.finance_accounting_transition_document(t,b,reviewer,doc,'issue',3,'');
  journal:=public.finance_accounting_post_document(t,b,reviewer,doc,a_cash,a_income);
  again:=public.finance_accounting_post_document(t,b,reviewer,doc,a_cash,a_income);
  IF NOT (journal->>'posted')::boolean OR NOT (again->>'idempotent')::boolean
     OR journal->>'id'<>again->>'id' THEN
    RAISE EXCEPTION 'STAGING FAIL: journal post/retry %, %',journal,again;
  END IF;

  SELECT count(*) INTO n FROM public.finance_accounting_journals WHERE tenant_id=t AND document_id=doc;
  IF n<>1 THEN RAISE EXCEPTION 'STAGING FAIL: repeated journal'; END IF;
  SELECT count(*) INTO n
    FROM public.finance_accounting_journal_lines
    WHERE tenant_id=t AND journal_id=(journal->>'id')::uuid
      AND currency='THB';
  IF n<>2 THEN RAISE EXCEPTION 'STAGING FAIL: double-entry line count'; END IF;

  BEGIN
    UPDATE public.finance_accounting_journals SET currency='USD' WHERE id=(journal->>'id')::uuid;
    RAISE EXCEPTION 'test_expected_error_not_raised';
  EXCEPTION WHEN others THEN
    IF SQLERRM='test_expected_error_not_raised' OR
      position('finance_accounting_append_only' IN SQLERRM)=0 THEN RAISE; END IF;
  END;
  RAISE NOTICE 'STAGING PASS: synthetic manual-income idempotency, numbering, approval, journal/retry, RLS and audit integrity';
END;
$test$;

SELECT 'STAGING_ALL_CHECKS_COMPLETED' AS status;
