-- Explicit anon grant exists via project default privileges; remove it.
REVOKE EXECUTE ON FUNCTION public.customer_portal_currency_summary_v1(uuid,uuid,timestamptz,timestamptz) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_portal_currency_summary_v1(uuid,uuid,timestamptz,timestamptz) TO authenticated;
