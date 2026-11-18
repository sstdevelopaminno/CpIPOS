-- DESIGN REVIEW ONLY. NOT A MIGRATION. DO NOT APPLY TO PRODUCTION.
-- Read-only assessment performed against CpiPOS-001 on 2026-11-18.
-- Requires tenant data-home routing, IT role policy, accounting/Tax approval, and RLS review.
-- Draft illustrates isolated service-role-only accounting tables. No legacy company balances.
-- All monetary values are INTEGER MINOR UNITS with a separate currency field.
BEGIN;

CREATE TABLE IF NOT EXISTS public.finance_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid REFERENCES public.branches(id),
  party_type text NOT NULL CHECK (party_type IN ('customer','supplier','both')),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 240),
  tax_id text, -- NULL until verified; do not invent
  contact_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES public.users_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,tenant_id,branch_id)
);
CREATE INDEX IF NOT EXISTS finance_parties_tenant_idx
 ON public.finance_parties (tenant_id,branch_id,party_type);

CREATE TABLE IF NOT EXISTS public.finance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  party_id uuid REFERENCES public.finance_parties(id),
  doc_type text NOT NULL CHECK (doc_type IN
    ('sales_quote','sales_order','delivery_note','sales_invoice',
     'purchase_request','purchase_order','goods_receipt','supplier_bill',
     'expense_voucher','payment_voucher')),
  document_no text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','submitted','approved','issued','rejected','voided')),
  currency text NOT NULL CHECK (currency IN ('THB','LAK','USD')),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  tax_minor bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  source_system text,
  source_type text,
  source_id text,
  source_document_id uuid REFERENCES public.finance_documents(id),
  document_date date NOT NULL,
  due_date date,
  prepared_by uuid NOT NULL REFERENCES public.users_profiles(id),
  approved_by uuid REFERENCES public.users_profiles(id),
  approved_at timestamptz,
  issued_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_documents_tax_bound CHECK (tax_minor <= amount_minor),
  CONSTRAINT finance_documents_approver_separate CHECK (approved_by IS NULL OR approved_by <> prepared_by),
  CONSTRAINT finance_documents_approval_complete CHECK
   ((approved_by IS NULL AND approved_at IS NULL) OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS finance_documents_number_uniq
 ON public.finance_documents (tenant_id,branch_id,doc_type,document_no)
 WHERE document_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS finance_documents_source_uniq
 ON public.finance_documents (tenant_id,branch_id,doc_type,source_system,source_type,source_id)
 WHERE source_system IS NOT NULL AND source_type IS NOT NULL AND source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_documents_aging_idx
 ON public.finance_documents (tenant_id,branch_id,doc_type,status,due_date);

CREATE TABLE IF NOT EXISTS public.finance_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  document_id uuid NOT NULL REFERENCES public.finance_documents(id),
  line_no integer NOT NULL CHECK (line_no > 0),
  description text NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity > 0),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  account_id uuid,
  source_line_id text,
  UNIQUE(document_id,line_no)
);

CREATE TABLE IF NOT EXISTS public.finance_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  document_id uuid NOT NULL REFERENCES public.finance_documents(id),
  prior_status text NOT NULL,
  next_status text NOT NULL,
  action text NOT NULL CHECK (action IN ('submit','approve','reject','issue','void','reverse')),
  actor_user_id uuid NOT NULL REFERENCES public.users_profiles(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS finance_document_events_doc_idx
 ON public.finance_document_events (tenant_id,branch_id,document_id,created_at);

CREATE TABLE IF NOT EXISTS public.finance_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  document_id uuid NOT NULL REFERENCES public.finance_documents(id),
  payment_source text NOT NULL CHECK (length(btrim(payment_source)) > 0),
  payment_id text NOT NULL,
  allocated_minor bigint NOT NULL CHECK (allocated_minor > 0),
  currency text NOT NULL CHECK (currency IN ('THB','LAK','USD')),
  created_by uuid NOT NULL REFERENCES public.users_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,branch_id,document_id,payment_source,payment_id)
);
CREATE INDEX IF NOT EXISTS finance_allocations_doc_idx
 ON public.finance_payment_allocations (tenant_id,branch_id,document_id);

CREATE TABLE IF NOT EXISTS public.finance_chart_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  account_code text NOT NULL CHECK(length(btrim(account_code)) BETWEEN 1 AND 32),
  name text NOT NULL CHECK(length(btrim(name)) > 0),
  account_type text NOT NULL CHECK(account_type IN ('asset','liability','equity','income','expense')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,account_code),
  UNIQUE (tenant_id,id)
);

CREATE TABLE IF NOT EXISTS public.finance_journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  source_type text NOT NULL,
  source_id text NOT NULL,
  event_type text NOT NULL,
  posting_key text NOT NULL,
  accounting_date date NOT NULL,
  currency text NOT NULL CHECK (currency IN ('THB','LAK','USD')),
  journal_status text NOT NULL DEFAULT 'pending' CHECK (journal_status IN ('pending','posted','reversed')),
  posted_by uuid REFERENCES public.users_profiles(id),
  posted_at timestamptz,
  reversed_by_journal_id uuid REFERENCES public.finance_journal_entries(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,branch_id,posting_key),
  UNIQUE (tenant_id,branch_id,source_type,source_id,event_type)
);
CREATE INDEX IF NOT EXISTS finance_journal_period_idx
 ON public.finance_journal_entries (tenant_id,branch_id,accounting_date,journal_status);

CREATE TABLE IF NOT EXISTS public.finance_journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  journal_id uuid NOT NULL REFERENCES public.finance_journal_entries(id),
  line_no integer NOT NULL CHECK (line_no > 0),
  account_id uuid NOT NULL REFERENCES public.finance_chart_accounts(id),
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  currency text NOT NULL CHECK (currency IN ('THB','LAK','USD')),
  CONSTRAINT finance_journal_single_side CHECK (
    (debit_minor > 0 AND credit_minor = 0) OR
    (credit_minor > 0 AND debit_minor = 0)
  ),
  UNIQUE(journal_id,line_no)
);
CREATE INDEX IF NOT EXISTS finance_journal_lines_account_idx
 ON public.finance_journal_lines (tenant_id,branch_id,account_id,journal_id);

CREATE TABLE IF NOT EXISTS public.finance_accounting_periods (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  locked_at timestamptz,
  locked_by uuid REFERENCES public.users_profiles(id),
  PRIMARY KEY(tenant_id,branch_id,period_start),
  CHECK(period_start <= period_end)
);

CREATE TABLE IF NOT EXISTS public.finance_bank_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  payment_account_id uuid NOT NULL REFERENCES public.tenant_payment_accounts(id),
  statement_fingerprint text NOT NULL,
  line_fingerprint text NOT NULL,
  transaction_date date NOT NULL,
  amount_minor bigint NOT NULL,
  currency text NOT NULL CHECK(currency IN ('THB','LAK','USD')),
  narration text,
  imported_by uuid NOT NULL REFERENCES public.users_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,branch_id,payment_account_id,statement_fingerprint,line_fingerprint)
);
CREATE TABLE IF NOT EXISTS public.finance_bank_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  statement_line_id uuid NOT NULL REFERENCES public.finance_bank_statement_lines(id),
  journal_id uuid NOT NULL REFERENCES public.finance_journal_entries(id),
  matched_minor bigint NOT NULL CHECK(matched_minor > 0),
  reviewed_by uuid NOT NULL REFERENCES public.users_profiles(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(statement_line_id,journal_id)
);

-- Data API deny-by-default: verified server session + service_role only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_parties','finance_documents','finance_document_lines','finance_document_events',
    'finance_payment_allocations','finance_chart_accounts','finance_journal_entries',
    'finance_journal_lines','finance_accounting_periods','finance_bank_statement_lines',
    'finance_bank_matches'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
  END LOOP;
END $$;
-- TODO before production: enforce immutable issued/posted records and posting balance
-- under one atomic SQL transaction. Avoid separate PostgREST writes for journal+lines.
-- TODO: composite tenant+branch foreign keys for every referenced business table.
-- TODO: source/home routing and explicit tenant-specific accounting period locks.
-- TODO: review Postgres SECURITY DEFINER execution privileges for any RPC.
ROLLBACK; -- DESIGN DRAFT ONLY: intentional ROLLBACK even if pasted into a SQL editor.
