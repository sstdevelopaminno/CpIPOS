-- Applied to CpiPOS-001 as Supabase migration 20261015070020.
-- Uses caller RLS; does not convert/merge THB, LAK and USD.
CREATE OR REPLACE FUNCTION public.customer_portal_currency_summary_v1(
  p_tenant_id uuid, p_branch_id uuid, p_from timestamptz, p_to timestamptz
)
RETURNS TABLE(currency_code text, receipt_count bigint, net_sales numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $function$
  SELECT
    CASE WHEN o.metadata->>'currency_code' IN ('THB','LAK','USD')
      THEN o.metadata->>'currency_code' ELSE 'THB' END AS currency_code,
    count(*)::bigint AS receipt_count,
    coalesce(sum(coalesce(o.grand_total,o.total_amount,0)),0)::numeric AS net_sales
  FROM public.orders o
  WHERE p_tenant_id IS NOT NULL
    AND o.tenant_id=p_tenant_id
    AND (p_branch_id IS NULL OR o.branch_id=p_branch_id)
    AND o.created_at >= p_from AND o.created_at < p_to
    AND o.status::text='completed'
  GROUP BY 1;
$function$;
REVOKE ALL ON FUNCTION public.customer_portal_currency_summary_v1(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_portal_currency_summary_v1(uuid,uuid,timestamptz,timestamptz) TO authenticated;
COMMENT ON FUNCTION public.customer_portal_currency_summary_v1(uuid,uuid,timestamptz,timestamptz)
  IS 'RLS-scoped monetary totals by immutable order currency snapshot, legacy null = THB. No FX conversion.';
