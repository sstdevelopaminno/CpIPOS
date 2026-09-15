-- Restrict the POS void/stock restore SECURITY DEFINER RPC to the server-side service role.
-- The backoffice API calls this RPC through getSupabaseServiceClient(); browser roles must not execute it directly.

REVOKE EXECUTE ON FUNCTION public.void_order_and_restore_stock_tx(uuid, uuid, uuid, uuid, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.void_order_and_restore_stock_tx(uuid, uuid, uuid, uuid, text, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.void_order_and_restore_stock_tx(uuid, uuid, uuid, uuid, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.void_order_and_restore_stock_tx(uuid, uuid, uuid, uuid, text, boolean) TO service_role;
