-- P0: POS queued-bill cancellation must restore recipe stock in the same database
-- transaction as the order cancellation. Never use direct status='cancelled' here.
-- This function is service-role only; a POS session and manager PIN must be
-- authorized by the API, and the PIN is revalidated inside the locked transaction.
CREATE OR REPLACE FUNCTION public.cancel_queued_pos_order_and_restore_stock_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_approval_id uuid,
  p_reason text
)
RETURNS TABLE(
  id uuid,
  order_no text,
  status text,
  cancelled_reason text,
  updated_at timestamptz,
  table_id uuid,
  restored_ingredient_count integer,
  restored_quantity numeric,
  table_session_closed_count integer,
  table_released boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'app', 'extensions'
SET lock_timeout TO '5s'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_void record;
  v_session_closed_count integer := 0;
  v_table_update_count integer := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_branch_id IS NULL OR p_order_id IS NULL
     OR p_actor_user_id IS NULL OR p_approval_id IS NULL THEN
    RAISE EXCEPTION 'CANCEL_SCOPE_REQUIRED';
  END IF;

  -- A row lock makes the queued-only precondition atomic with void/stock restore:
  -- a concurrently completed payment cannot be voided by this queued-only API.
  SELECT o.* INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.tenant_id = p_tenant_id
     AND o.branch_id = p_branch_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF v_order.status::text <> 'queued' THEN
    RAISE EXCEPTION 'ORDER_NOT_QUEUED';
  END IF;

  PERFORM 1
    FROM public.manager_pin_approvals a
   WHERE a.id = p_approval_id
     AND a.tenant_id = p_tenant_id
     AND a.branch_id = p_branch_id
     AND a.action::text = 'cancel_bill'
     AND a.target_table = 'orders'
     AND a.target_id = p_order_id
     AND (a.expires_at IS NULL OR a.expires_at > now())
     AND a.consumed_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CANCELLATION_APPROVAL_INVALID';
  END IF;

  -- The existing audited RPC uses the same transaction and performs an
  -- idempotent per-ingredient reversal of sale_deduction ledger entries.
  SELECT * INTO v_void
    FROM app.void_order_and_restore_stock_tx(
      p_tenant_id, p_branch_id, p_order_id, p_actor_user_id,
      COALESCE(NULLIF(trim(p_reason), ''), 'Cancelled POS bill'), false
    );

  IF NOT FOUND OR v_void.already_cancelled THEN
    RAISE EXCEPTION 'ORDER_NOT_QUEUED';
  END IF;

  UPDATE public.orders o
     SET cancellation_approval_id = p_approval_id
   WHERE o.id = p_order_id
     AND o.tenant_id = p_tenant_id
     AND o.branch_id = p_branch_id;

  UPDATE public.manager_pin_approvals a
     SET consumed_at = now()
   WHERE a.id = p_approval_id
     AND a.tenant_id = p_tenant_id
     AND a.branch_id = p_branch_id;

  IF v_order.table_id IS NOT NULL THEN
    -- Close only the session attached to THIS order, never a newer table bill.
    UPDATE public.table_bill_sessions s
       SET status = 'cancelled',
           closed_by = p_actor_user_id,
           closed_at = now()
     WHERE s.tenant_id = p_tenant_id
       AND s.branch_id = p_branch_id
       AND s.order_id = p_order_id
       AND s.status IN ('open', 'ordering', 'pending_payment');
    GET DIAGNOSTICS v_session_closed_count = ROW_COUNT;

    -- A different active table session must never be marked available.
    UPDATE public.dining_tables t
       SET status = 'available'
     WHERE t.tenant_id = p_tenant_id
       AND t.branch_id = p_branch_id
       AND t.id = v_order.table_id
       AND NOT EXISTS (
         SELECT 1 FROM public.table_bill_sessions s
          WHERE s.tenant_id = p_tenant_id
            AND s.branch_id = p_branch_id
            AND s.table_id = t.id
            AND s.status IN ('open', 'ordering', 'pending_payment')
            AND s.closed_at IS NULL
       );
    GET DIAGNOSTICS v_table_update_count = ROW_COUNT;
  END IF;

  RETURN QUERY
  SELECT o.id, o.order_no, o.status::text, o.cancelled_reason, o.updated_at,
         o.table_id, COALESCE(v_void.restored_ingredient_count, 0)::integer,
         COALESCE(v_void.restored_quantity, 0)::numeric,
         v_session_closed_count, (v_table_update_count > 0)
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.tenant_id = p_tenant_id
     AND o.branch_id = p_branch_id;
END;
$function$;

-- Restrict this SECURITY DEFINER entrypoint to authenticated server-to-server
-- database calls. Never expose the cancellation+stock mutation to browser keys.
REVOKE ALL ON FUNCTION public.cancel_queued_pos_order_and_restore_stock_tx(
  uuid, uuid, uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_queued_pos_order_and_restore_stock_tx(
  uuid, uuid, uuid, uuid, uuid, text
) TO service_role;

-- Defense in depth for the older underlying privileged stock-restore function.
-- Live privilege review found authenticated could EXECUTE app.void_order...
-- while the public API wrapper is already restricted to service_role.
-- Only the trusted backend should be able to trigger destructive stock reversals.
REVOKE ALL ON FUNCTION app.void_order_and_restore_stock_tx(
  uuid, uuid, uuid, uuid, text, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.void_order_and_restore_stock_tx(
  uuid, uuid, uuid, uuid, text, boolean
) TO service_role;
