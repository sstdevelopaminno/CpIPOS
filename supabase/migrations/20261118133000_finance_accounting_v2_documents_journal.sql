-- Finance accounting v2: isolated, tenant/branch-scoped accounting records.
-- Reviewed code ONLY until staging acceptance. Do not apply to production automatically.
-- Requires explicit Finance session/IT policy in the Next.js API and service-role RPC.
-- No POS orders or previously issued tax documents are modified here.

CREATE TABLE IF NOT EXISTS public.finance_accounting_chart (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  account_code text NOT NULL CHECK (length(btrim(account_code)) BETWEEN 1 AND 32),
  account_name text NOT NULL CHECK (length(btrim(account_name)) BETWEEN 1 AND 160),
  account_type text NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense')),
  created_by uuid NOT NULL REFERENCES public.users_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,account_code), UNIQUE(tenant_id,id)
);

CREATE TABLE IF NOT EXISTS public.finance_accounting_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  document_kind text NOT NULL CHECK(document_kind IN (
    'sales_quote','sales_order','delivery_note','sales_invoice',
    'purchase_request','purchase_order','goods_receipt','supplier_bill',
    'expense_voucher','receipt_voucher','payment_voucher'
  )),
  document_no text NOT NULL,
  counterparty_name text NOT NULL CHECK(length(btrim(counterparty_name)) BETWEEN 1 AND 240),
  document_date date NOT NULL,
  due_date date,
  currency text NOT NULL CHECK(currency IN ('THB','LAK','USD')),
  amount_minor bigint NOT NULL CHECK(amount_minor > 0 AND amount_minor <= 99999999999999),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK(tax_minor = 0),
  -- Tax / VAT and withholding posting are gated until verified source documents exist.
  status text NOT NULL DEFAULT 'draft' CHECK(status IN
    ('draft','submitted','approved','rejected','issued','voided')),
  source_document_id uuid,
  request_key uuid NOT NULL,
  request_snapshot jsonb NOT NULL,
  prepared_by uuid NOT NULL REFERENCES public.users_profiles(id),
  approved_by uuid REFERENCES public.users_profiles(id),
  approved_at timestamptz,
  issued_at timestamptz,
  posted_journal_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,branch_id,id),
  UNIQUE(tenant_id,branch_id,document_kind,document_no),
  UNIQUE(tenant_id,branch_id,request_key),
  CONSTRAINT finance_accounting_self_approval CHECK(approved_by IS NULL OR approved_by <> prepared_by),
  CONSTRAINT finance_accounting_approval_pair CHECK(
    (approved_by IS NULL AND approved_at IS NULL) OR
    (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  ),
  CONSTRAINT finance_accounting_source_branch
    FOREIGN KEY (tenant_id,branch_id,source_document_id)
    REFERENCES public.finance_accounting_documents(tenant_id,branch_id,id)
);
CREATE INDEX IF NOT EXISTS finance_accounting_documents_aging_idx
 ON public.finance_accounting_documents(tenant_id,branch_id,document_kind,status,due_date);

CREATE TABLE IF NOT EXISTS public.finance_accounting_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  document_id uuid NOT NULL,
  line_no integer NOT NULL CHECK(line_no BETWEEN 1 AND 100),
  description text NOT NULL CHECK(length(btrim(description)) BETWEEN 1 AND 500),
  quantity numeric(20,6) NOT NULL CHECK(quantity > 0),
  unit_minor bigint NOT NULL CHECK(unit_minor >= 0),
  line_minor bigint NOT NULL CHECK(line_minor > 0),
  UNIQUE(document_id,line_no),
  FOREIGN KEY(tenant_id,branch_id,document_id)
    REFERENCES public.finance_accounting_documents(tenant_id,branch_id,id)
);

CREATE TABLE IF NOT EXISTS public.finance_accounting_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  document_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('created','submitted','approved','rejected','issued','voided','posted')),
  old_status text,
  new_status text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES public.users_profiles(id),
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(tenant_id,branch_id,document_id)
    REFERENCES public.finance_accounting_documents(tenant_id,branch_id,id)
);
CREATE INDEX IF NOT EXISTS finance_accounting_events_idx
 ON public.finance_accounting_document_events(tenant_id,branch_id,document_id,created_at);

CREATE TABLE IF NOT EXISTS public.finance_accounting_periods (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  period_month date NOT NULL CHECK(EXTRACT(day FROM period_month) = 1),
  locked_at timestamptz,
  locked_by uuid REFERENCES public.users_profiles(id),
  PRIMARY KEY(tenant_id,branch_id,period_month)
);

CREATE TABLE IF NOT EXISTS public.finance_accounting_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  document_id uuid NOT NULL,
  posting_key text NOT NULL CHECK(length(posting_key) BETWEEN 1 AND 512),
  event_type text NOT NULL CHECK(event_type = 'document_issued'),
  currency text NOT NULL CHECK(currency IN ('THB','LAK','USD')),
  accounting_date date NOT NULL,
  debit_total_minor bigint NOT NULL CHECK(debit_total_minor > 0),
  credit_total_minor bigint NOT NULL CHECK(credit_total_minor > 0),
  posted_by uuid NOT NULL REFERENCES public.users_profiles(id),
  posted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,branch_id,id),
  UNIQUE(tenant_id,branch_id,document_id),
  UNIQUE(tenant_id,branch_id,posting_key),
  FOREIGN KEY(tenant_id,branch_id,document_id)
    REFERENCES public.finance_accounting_documents(tenant_id,branch_id,id),
  CHECK(debit_total_minor=credit_total_minor)
);

CREATE TABLE IF NOT EXISTS public.finance_accounting_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  journal_id uuid NOT NULL,
  line_no integer NOT NULL CHECK(line_no BETWEEN 1 AND 100),
  account_id uuid NOT NULL,
  currency text NOT NULL CHECK(currency IN ('THB','LAK','USD')),
  debit_minor bigint NOT NULL DEFAULT 0 CHECK(debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK(credit_minor >= 0),
  UNIQUE(journal_id,line_no),
  FOREIGN KEY(tenant_id,branch_id,journal_id)
    REFERENCES public.finance_accounting_journals(tenant_id,branch_id,id),
  FOREIGN KEY(tenant_id,account_id)
    REFERENCES public.finance_accounting_chart(tenant_id,id),
  CHECK((debit_minor>0 AND credit_minor=0) OR (debit_minor=0 AND credit_minor>0))
);

CREATE TABLE IF NOT EXISTS public.finance_accounting_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  source_document_id uuid NOT NULL,
  settlement_document_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor > 0),
  currency text NOT NULL CHECK(currency IN ('THB','LAK','USD')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,branch_id,settlement_document_id),
  FOREIGN KEY(tenant_id,branch_id,source_document_id)
    REFERENCES public.finance_accounting_documents(tenant_id,branch_id,id),
  FOREIGN KEY(tenant_id,branch_id,settlement_document_id)
    REFERENCES public.finance_accounting_documents(tenant_id,branch_id,id)
);

ALTER TABLE public.finance_accounting_documents
  ADD CONSTRAINT finance_accounting_posted_journal_fk
  FOREIGN KEY(tenant_id,branch_id,posted_journal_id)
  REFERENCES public.finance_accounting_journals(tenant_id,branch_id,id);

-- Only the RPC owner can mutate. PostgREST service role may SELECT.
DO $ddl$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_accounting_chart','finance_accounting_documents',
    'finance_accounting_document_lines','finance_accounting_document_events',
    'finance_accounting_periods','finance_accounting_journals',
    'finance_accounting_journal_lines','finance_accounting_allocations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role',t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role',t);
  END LOOP;
END $ddl$;

CREATE OR REPLACE FUNCTION public.finance_accounting_check_actor(
  p_tenant uuid,p_branch uuid,p_actor uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.user_branch_roles r
      JOIN public.branches b ON b.id=r.branch_id AND b.tenant_id=r.tenant_id
      JOIN public.tenants t ON t.id=r.tenant_id
      JOIN public.users_profiles u ON u.id=r.user_id
    WHERE r.tenant_id=p_tenant AND r.branch_id=p_branch AND r.user_id=p_actor
      AND r.role::text='accountant' AND b.is_active AND t.is_active AND u.is_active
  ) THEN RAISE EXCEPTION 'finance_accounting_actor_forbidden' USING ERRCODE='42501'; END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION public.finance_accounting_check_actor(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_accounting_check_actor(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finance_accounting_create_account(
 p_tenant uuid,p_branch uuid,p_actor uuid,p_code text,p_name text,p_type text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_id uuid; v_code text := btrim(p_code); v_name text := btrim(p_name);
BEGIN
  PERFORM public.finance_accounting_check_actor(p_tenant,p_branch,p_actor);
  IF length(v_code) NOT BETWEEN 1 AND 32 OR length(v_name) NOT BETWEEN 1 AND 160 OR
    p_type NOT IN ('asset','liability','equity','income','expense')
    THEN RAISE EXCEPTION 'finance_accounting_account_invalid'; END IF;
  INSERT INTO public.finance_accounting_chart(tenant_id,account_code,account_name,account_type,created_by)
    VALUES(p_tenant,v_code,v_name,p_type,p_actor) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id',v_id,'created',true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.finance_accounting_create_account(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_accounting_create_account(uuid,uuid,uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.finance_accounting_create_document(
 p_tenant uuid,p_branch uuid,p_actor uuid,p_kind text,p_no text,p_counterparty text,
 p_date date,p_due date,p_currency text,p_lines jsonb,p_request uuid,
 p_source uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_id uuid; v_row record; v_sum bigint := 0; v_num integer := 0;
  v_signature jsonb; v_old public.finance_accounting_documents%ROWTYPE;
BEGIN
  PERFORM public.finance_accounting_check_actor(p_tenant,p_branch,p_actor);
  IF p_kind NOT IN ('sales_quote','sales_order','delivery_note','sales_invoice',
    'purchase_request','purchase_order','goods_receipt','supplier_bill',
    'expense_voucher','receipt_voucher','payment_voucher') OR
    p_currency NOT IN ('THB','LAK','USD') OR
    length(btrim(p_no)) NOT BETWEEN 1 AND 64 OR
    length(btrim(p_counterparty)) NOT BETWEEN 1 AND 240 OR
    p_date IS NULL OR p_request IS NULL OR
    jsonb_typeof(p_lines) IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_lines) NOT BETWEEN 1 AND 100
    THEN RAISE EXCEPTION 'finance_accounting_document_invalid'; END IF;

  IF p_kind IN ('sales_invoice','supplier_bill') AND (p_due IS NULL OR p_due<p_date)
    THEN RAISE EXCEPTION 'finance_accounting_due_date_required'; END IF;
  IF p_kind IN ('receipt_voucher','payment_voucher') AND p_source IS NULL
    THEN RAISE EXCEPTION 'finance_accounting_settlement_source_required'; END IF;
  IF p_source IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.finance_accounting_documents d
    WHERE d.tenant_id=p_tenant AND d.branch_id=p_branch AND d.id=p_source
  ) THEN RAISE EXCEPTION 'finance_accounting_source_not_found'; END IF;

  v_signature := jsonb_build_object('kind',p_kind,'number',btrim(p_no),
    'counterparty',btrim(p_counterparty),'date',p_date,'due',p_due,
    'currency',p_currency,'lines',p_lines,'source',p_source);
  -- Hold an advisory transaction lock on a stable request key before lookup/insert.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_tenant::text||'/'||p_branch::text||'/'||p_request::text,0));
  SELECT * INTO v_old FROM public.finance_accounting_documents
    WHERE tenant_id=p_tenant AND branch_id=p_branch AND request_key=p_request;
  IF FOUND THEN
    IF v_old.request_snapshot <> v_signature
      THEN RAISE EXCEPTION 'finance_accounting_idempotency_conflict'; END IF;
    RETURN jsonb_build_object('id',v_old.id,'status',v_old.status,'created',false);
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_num:=v_num+1;
    IF jsonb_typeof(v_row.value) <> 'object' OR
       length(btrim(v_row.value->>'description')) NOT BETWEEN 1 AND 500 OR
       (v_row.value->>'quantity')::numeric <= 0 OR
       (v_row.value->>'lineMinor')::bigint <= 0 OR
       (v_row.value->>'unitMinor')::bigint < 0
      THEN RAISE EXCEPTION 'finance_accounting_line_invalid'; END IF;
    v_sum := v_sum+(v_row.value->>'lineMinor')::bigint;
    IF v_sum>99999999999999 THEN RAISE EXCEPTION 'finance_accounting_total_too_large'; END IF;
  END LOOP;

  IF v_num=0 OR v_sum<=0 THEN RAISE EXCEPTION 'finance_accounting_empty_document'; END IF;
  INSERT INTO public.finance_accounting_documents
    (tenant_id,branch_id,document_kind,document_no,counterparty_name,document_date,
      due_date,currency,amount_minor,tax_minor,status,source_document_id,request_key,
      request_snapshot,prepared_by)
   VALUES(p_tenant,p_branch,p_kind,btrim(p_no),btrim(p_counterparty),p_date,p_due,
      p_currency,v_sum,0,'draft',p_source,p_request,v_signature,p_actor) RETURNING id INTO v_id;
  INSERT INTO public.finance_accounting_document_lines
    (tenant_id,branch_id,document_id,line_no,description,quantity,unit_minor,line_minor)
  SELECT p_tenant,p_branch,v_id,ord, btrim(line->>'description'),
     (line->>'quantity')::numeric,(line->>'unitMinor')::bigint,(line->>'lineMinor')::bigint
  FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS x(line,ord);
  INSERT INTO public.finance_accounting_document_events
    (tenant_id,branch_id,document_id,action,old_status,new_status,actor_user_id)
  VALUES(p_tenant,p_branch,v_id,'created',NULL,'draft',p_actor);
  RETURN jsonb_build_object('id',v_id,'status','draft','created',true);
END;
$fn$;
REVOKE ALL ON FUNCTION public.finance_accounting_create_document(uuid,uuid,uuid,text,text,text,date,date,text,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_accounting_create_document(uuid,uuid,uuid,text,text,text,date,date,text,jsonb,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finance_accounting_transition_document(
 p_tenant uuid,p_branch uuid,p_actor uuid,p_document uuid,p_action text,
 p_expected_version integer,p_reason text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_doc public.finance_accounting_documents%ROWTYPE; v_next text;
BEGIN
  PERFORM public.finance_accounting_check_actor(p_tenant,p_branch,p_actor);
  SELECT * INTO v_doc FROM public.finance_accounting_documents
    WHERE id=p_document AND tenant_id=p_tenant AND branch_id=p_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'finance_accounting_document_not_found'; END IF;
  IF v_doc.version<>p_expected_version THEN RAISE EXCEPTION 'finance_accounting_version_conflict'; END IF;
  v_next:=CASE
    WHEN p_action='submit' AND v_doc.status IN ('draft','rejected') THEN 'submitted'
    WHEN p_action='approve' AND v_doc.status='submitted' THEN 'approved'
    WHEN p_action='reject' AND v_doc.status='submitted' THEN 'rejected'
    WHEN p_action='issue' AND v_doc.status='approved' THEN 'issued'
    WHEN p_action='void' AND v_doc.status='issued' AND v_doc.posted_journal_id IS NULL THEN 'voided'
    ELSE NULL END;
  IF v_next IS NULL THEN RAISE EXCEPTION 'finance_accounting_transition_forbidden'; END IF;
  IF p_action IN ('approve','reject') AND p_actor=v_doc.prepared_by
    THEN RAISE EXCEPTION 'finance_accounting_self_approval_forbidden'; END IF;
  IF p_action='issue' AND v_doc.approved_by IS NULL
    THEN RAISE EXCEPTION 'finance_accounting_approval_required'; END IF;
  IF p_action='void' AND length(btrim(p_reason))<10
    THEN RAISE EXCEPTION 'finance_accounting_void_reason_required'; END IF;
  UPDATE public.finance_accounting_documents SET status=v_next,version=version+1,
    updated_at=now(),
    approved_by=CASE WHEN p_action='approve' THEN p_actor
      WHEN p_action IN ('reject','submit') THEN NULL ELSE approved_by END,
    approved_at=CASE WHEN p_action='approve' THEN now()
      WHEN p_action IN ('reject','submit') THEN NULL ELSE approved_at END,
    issued_at=CASE WHEN p_action='issue' THEN now() ELSE issued_at END
  WHERE id=p_document;
  INSERT INTO public.finance_accounting_document_events
    (tenant_id,branch_id,document_id,action,old_status,new_status,actor_user_id,event_payload)
  VALUES(p_tenant,p_branch,p_document,
    CASE p_action WHEN 'submit' THEN 'submitted' WHEN 'approve' THEN 'approved'
      WHEN 'reject' THEN 'rejected' WHEN 'issue' THEN 'issued' ELSE 'voided' END,
    v_doc.status,v_next,p_actor,jsonb_build_object('reason',p_reason,'priorVersion',p_expected_version));
  RETURN jsonb_build_object('id',p_document,'status',v_next,'version',p_expected_version+1);
END;
$fn$;
REVOKE ALL ON FUNCTION public.finance_accounting_transition_document(uuid,uuid,uuid,uuid,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_accounting_transition_document(uuid,uuid,uuid,uuid,text,integer,text) TO service_role;

CREATE OR REPLACE FUNCTION public.finance_accounting_post_document(
 p_tenant uuid,p_branch uuid,p_actor uuid,p_document uuid,
 p_debit_account uuid,p_credit_account uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE v_doc public.finance_accounting_documents%ROWTYPE;
  v_parent public.finance_accounting_documents%ROWTYPE;
  v_debit_type text; v_credit_type text;
  v_entry uuid; v_used bigint; v_key text;
  v_period date;
BEGIN
  PERFORM public.finance_accounting_check_actor(p_tenant,p_branch,p_actor);
  SELECT * INTO v_doc FROM public.finance_accounting_documents
    WHERE id=p_document AND tenant_id=p_tenant AND branch_id=p_branch FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'finance_accounting_document_not_found'; END IF;
  IF v_doc.posted_journal_id IS NOT NULL THEN
    SELECT jl.account_id INTO STRICT p_debit_account
      FROM public.finance_accounting_journal_lines jl
      WHERE jl.tenant_id=p_tenant AND jl.branch_id=p_branch
       AND jl.journal_id=v_doc.posted_journal_id AND jl.line_no=1;
    RETURN jsonb_build_object('id',v_doc.posted_journal_id,'posted',false,
      'idempotent',true);
  END IF;
  IF v_doc.status<>'issued' OR v_doc.approved_by IS NULL OR p_actor=v_doc.prepared_by
    THEN RAISE EXCEPTION 'finance_accounting_posting_not_approved'; END IF;
  IF v_doc.document_kind NOT IN ('sales_invoice','supplier_bill',
       'expense_voucher','receipt_voucher','payment_voucher')
    THEN RAISE EXCEPTION 'finance_accounting_posting_kind_forbidden'; END IF;
  IF v_doc.tax_minor<>0 THEN RAISE EXCEPTION 'finance_accounting_verified_tax_required'; END IF;
  v_period:=pg_catalog.date_trunc('month',v_doc.document_date)::date;
  IF EXISTS(SELECT 1 FROM public.finance_accounting_periods
    WHERE tenant_id=p_tenant AND branch_id=p_branch AND period_month=v_period
      AND locked_at IS NOT NULL)
    THEN RAISE EXCEPTION 'finance_accounting_period_locked'; END IF;
  IF p_debit_account=p_credit_account THEN
    RAISE EXCEPTION 'finance_accounting_accounts_same'; END IF;
  SELECT account_type INTO v_debit_type FROM public.finance_accounting_chart
    WHERE tenant_id=p_tenant AND id=p_debit_account;
  SELECT account_type INTO v_credit_type FROM public.finance_accounting_chart
    WHERE tenant_id=p_tenant AND id=p_credit_account;
  IF v_debit_type IS NULL OR v_credit_type IS NULL THEN
    RAISE EXCEPTION 'finance_accounting_account_not_found'; END IF;
  IF NOT (
    (v_doc.document_kind='sales_invoice' AND v_debit_type='asset' AND v_credit_type='income') OR
    (v_doc.document_kind='supplier_bill' AND v_debit_type='expense' AND v_credit_type='liability') OR
    (v_doc.document_kind='expense_voucher' AND v_debit_type='expense' AND v_credit_type='asset') OR
    (v_doc.document_kind='receipt_voucher' AND v_debit_type='asset' AND v_credit_type='asset') OR
    (v_doc.document_kind='payment_voucher' AND v_debit_type='liability' AND v_credit_type='asset')
  ) THEN RAISE EXCEPTION 'finance_accounting_account_type_invalid'; END IF;

  IF v_doc.document_kind IN ('receipt_voucher','payment_voucher') THEN
    SELECT * INTO v_parent FROM public.finance_accounting_documents
      WHERE tenant_id=p_tenant AND branch_id=p_branch AND id=v_doc.source_document_id FOR UPDATE;
    IF NOT FOUND OR v_parent.posted_journal_id IS NULL OR
       v_parent.currency<>v_doc.currency OR
       (v_doc.document_kind='receipt_voucher' AND v_parent.document_kind<>'sales_invoice') OR
       (v_doc.document_kind='payment_voucher' AND v_parent.document_kind<>'supplier_bill')
    THEN RAISE EXCEPTION 'finance_accounting_settlement_source_invalid'; END IF;
    SELECT COALESCE(sum(amount_minor),0) INTO v_used
      FROM public.finance_accounting_allocations
      WHERE tenant_id=p_tenant AND branch_id=p_branch AND source_document_id=v_parent.id;
    IF v_used+v_doc.amount_minor>v_parent.amount_minor
      THEN RAISE EXCEPTION 'finance_accounting_overallocation'; END IF;
  END IF;

  v_key:=p_tenant::text||'/'||p_branch::text||'/finance_document/'||p_document::text||'/issued';
  INSERT INTO public.finance_accounting_journals
    (tenant_id,branch_id,document_id,posting_key,event_type,currency,accounting_date,
     debit_total_minor,credit_total_minor,posted_by)
  VALUES(p_tenant,p_branch,p_document,v_key,'document_issued',v_doc.currency,
    v_doc.document_date,v_doc.amount_minor,v_doc.amount_minor,p_actor)
  RETURNING id INTO v_entry;
  INSERT INTO public.finance_accounting_journal_lines
    (tenant_id,branch_id,journal_id,line_no,account_id,currency,debit_minor,credit_minor)
  VALUES
    (p_tenant,p_branch,v_entry,1,p_debit_account,v_doc.currency,v_doc.amount_minor,0),
    (p_tenant,p_branch,v_entry,2,p_credit_account,v_doc.currency,0,v_doc.amount_minor);
  IF v_doc.document_kind IN ('receipt_voucher','payment_voucher') THEN
    INSERT INTO public.finance_accounting_allocations
      (tenant_id,branch_id,source_document_id,settlement_document_id,amount_minor,currency)
    VALUES(p_tenant,p_branch,v_parent.id,p_document,v_doc.amount_minor,v_doc.currency);
  END IF;
  UPDATE public.finance_accounting_documents SET posted_journal_id=v_entry,
    version=version+1,updated_at=now() WHERE id=p_document;
  INSERT INTO public.finance_accounting_document_events
    (tenant_id,branch_id,document_id,action,old_status,new_status,actor_user_id,event_payload)
  VALUES(p_tenant,p_branch,p_document,'posted',v_doc.status,v_doc.status,p_actor,
    jsonb_build_object('journalId',v_entry));
  RETURN jsonb_build_object('id',v_entry,'posted',true,'idempotent',false);
END;
$fn$;
REVOKE ALL ON FUNCTION public.finance_accounting_post_document(uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finance_accounting_post_document(uuid,uuid,uuid,uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finance_accounting_forbid_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path=''
AS $fn$
BEGIN RAISE EXCEPTION 'finance_accounting_append_only'; END;
$fn$;
DROP TRIGGER IF EXISTS finance_accounting_events_no_mutation ON public.finance_accounting_document_events;
CREATE TRIGGER finance_accounting_events_no_mutation BEFORE UPDATE OR DELETE
 ON public.finance_accounting_document_events FOR EACH ROW
 EXECUTE FUNCTION public.finance_accounting_forbid_audit_mutation();
DROP TRIGGER IF EXISTS finance_accounting_journals_no_mutation ON public.finance_accounting_journals;
CREATE TRIGGER finance_accounting_journals_no_mutation BEFORE UPDATE OR DELETE
 ON public.finance_accounting_journals FOR EACH ROW
 EXECUTE FUNCTION public.finance_accounting_forbid_audit_mutation();
DROP TRIGGER IF EXISTS finance_accounting_journal_lines_no_mutation ON public.finance_accounting_journal_lines;
CREATE TRIGGER finance_accounting_journal_lines_no_mutation BEFORE UPDATE OR DELETE
 ON public.finance_accounting_journal_lines FOR EACH ROW
 EXECUTE FUNCTION public.finance_accounting_forbid_audit_mutation();
DROP TRIGGER IF EXISTS finance_accounting_allocations_no_mutation ON public.finance_accounting_allocations;
CREATE TRIGGER finance_accounting_allocations_no_mutation BEFORE UPDATE OR DELETE
 ON public.finance_accounting_allocations FOR EACH ROW
 EXECUTE FUNCTION public.finance_accounting_forbid_audit_mutation();
REVOKE ALL ON FUNCTION public.finance_accounting_forbid_audit_mutation() FROM PUBLIC,anon,authenticated;
