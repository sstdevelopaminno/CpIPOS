-- Canonical CpiPOS-001 schema. Applied through Supabase migration authority.
-- Secure by default: no tenant policies enabled until authorized IT operator opts in.
CREATE TABLE IF NOT EXISTS public.tenant_android_security_policies (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enforce_developer_options_off boolean NOT NULL DEFAULT false,
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_android_security_policies ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_android_security_policies FROM anon, authenticated;
COMMENT ON TABLE public.tenant_android_security_policies IS 'IT-managed per-tenant Native Android developer/ADB security gate (default disabled)';
