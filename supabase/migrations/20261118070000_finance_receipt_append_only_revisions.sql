-- Append-only Finance receipt corrections: never UPDATE the original POS sale,
-- historic payment events or an already-issued tax invoice.
CREATE TABLE IF NOT EXISTS public.finance_receipt_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  order_id uuid NOT NULL REFERENCES public.orders(id),
  revision integer NOT NULL CHECK (revision BETWEEN 1 AND 200),
  action text NOT NULL CHECK (action IN ('corrected', 'voided')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_receipt_revisions_version_uniq UNIQUE (tenant_id, branch_id, order_id, revision)
);
CREATE INDEX IF NOT EXISTS finance_receipt_revisions_order_idx
  ON public.finance_receipt_revisions (tenant_id, branch_id, order_id, revision DESC);
ALTER TABLE public.finance_receipt_revisions ENABLE ROW LEVEL SECURITY;
-- Access is through server-side Finance session with a service-role client only.
REVOKE ALL ON TABLE public.finance_receipt_revisions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.finance_receipt_revisions TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_finance_receipt_revision_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'finance_receipt_revisions are append-only';
END;
$$;
DROP TRIGGER IF EXISTS finance_receipt_revisions_immutable ON public.finance_receipt_revisions;
CREATE TRIGGER finance_receipt_revisions_immutable
BEFORE UPDATE OR DELETE ON public.finance_receipt_revisions
FOR EACH ROW EXECUTE FUNCTION public.prevent_finance_receipt_revision_mutation();
REVOKE ALL ON FUNCTION public.prevent_finance_receipt_revision_mutation() FROM PUBLIC, anon, authenticated;
