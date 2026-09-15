-- Fix POS void stock restoration so automated bill reversals are not treated
-- as operator manual stock adjustments that require a manager PIN approval.
--
-- The request_id remains deterministic per order + ingredient, preserving
-- exact-once/idempotent restoration under retries and concurrent requests.

CREATE OR REPLACE FUNCTION app.void_order_and_restore_stock_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_actor_user_id uuid,
  p_reason text DEFAULT 'Cancelled POS bill',
  p_mark_deleted boolean DEFAULT false
)
RETURNS TABLE(
  order_id uuid,
  already_cancelled boolean,
  restored_ingredient_count integer,
  restored_quantity numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'app', 'extensions'
SET lock_timeout TO '5s'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_request_id text;
  v_restored_count integer := 0;
  v_restored_quantity numeric := 0;
  v_metadata jsonb;
  v_now timestamptz := now();
  rec record;
BEGIN
  SELECT o.*
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
     AND o.tenant_id = p_tenant_id
     AND o.branch_id = p_branch_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND:%', p_order_id;
  END IF;

  already_cancelled := (v_order.status = 'cancelled');

  FOR rec IN
    SELECT sm.ingredient_id,
           round(sum(-sm.quantity_delta), 0)::numeric AS restore_qty
      FROM public.stock_movements sm
     WHERE sm.tenant_id = p_tenant_id
       AND sm.branch_id = p_branch_id
       AND sm.ref_table = 'orders'
       AND sm.ref_id = p_order_id
       AND sm.movement_type = 'sale_deduction'
       AND sm.quantity_delta < 0
     GROUP BY sm.ingredient_id
    HAVING sum(-sm.quantity_delta) > 0
  LOOP
    v_request_id := 'void_restore:' || p_order_id::text || ':' || rec.ingredient_id::text;

    IF NOT EXISTS (
      SELECT 1
        FROM public.stock_movements sm
       WHERE sm.tenant_id = p_tenant_id
         AND sm.branch_id = p_branch_id
         AND sm.request_id = v_request_id
    ) THEN
      UPDATE public.ingredients i
         SET quantity_on_hand = round(i.quantity_on_hand + rec.restore_qty, 0),
             updated_at = v_now
       WHERE i.id = rec.ingredient_id
         AND i.tenant_id = p_tenant_id
         AND i.branch_id = p_branch_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'INGREDIENT_NOT_FOUND:%', rec.ingredient_id;
      END IF;

      INSERT INTO public.stock_movements (
        tenant_id,
        branch_id,
        ingredient_id,
        movement_type,
        quantity_delta,
        reason,
        ref_table,
        ref_id,
        created_by,
        request_id
      ) VALUES (
        p_tenant_id,
        p_branch_id,
        rec.ingredient_id,
        'sale_void_restore',
        rec.restore_qty,
        coalesce(nullif(trim(p_reason), ''), 'Cancelled POS bill') || ' - stock return',
        'orders',
        p_order_id,
        p_actor_user_id,
        v_request_id
      );

      v_restored_count := v_restored_count + 1;
      v_restored_quantity := v_restored_quantity + rec.restore_qty;
    END IF;
  END LOOP;

  DELETE FROM public.payments p
   WHERE p.tenant_id = p_tenant_id
     AND p.branch_id = p_branch_id
     AND p.order_id = p_order_id;

  v_metadata := coalesce(v_order.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'stock_restored_at', v_now,
      'stock_restored_by', p_actor_user_id,
      'stock_restore_version', 2
    );

  IF p_mark_deleted THEN
    v_metadata := v_metadata || jsonb_build_object(
      'sales_list_deleted', true,
      'sales_list_deleted_at', v_now,
      'sales_list_deleted_by', p_actor_user_id
    );
  END IF;

  UPDATE public.orders
     SET status = 'cancelled',
         cancelled_by = coalesce(cancelled_by, p_actor_user_id),
         cancelled_reason = coalesce(nullif(trim(p_reason), ''), cancelled_reason, 'Cancelled POS bill'),
         payment_completed_at = NULL,
         payment_completed_by = NULL,
         cash_received = NULL,
         change_amount = NULL,
         paid_total = 0,
         metadata = v_metadata,
         updated_at = v_now
   WHERE id = p_order_id
     AND tenant_id = p_tenant_id
     AND branch_id = p_branch_id;

  order_id := p_order_id;
  restored_ingredient_count := v_restored_count;
  restored_quantity := v_restored_quantity;
  RETURN NEXT;
END;
$function$;

-- Keep the API-facing wrapper service-role only. The wrapper created by the
-- original stability migration delegates to app.void_order_and_restore_stock_tx.
REVOKE ALL ON FUNCTION public.void_order_and_restore_stock_tx(uuid, uuid, uuid, uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.void_order_and_restore_stock_tx(uuid, uuid, uuid, uuid, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.void_order_and_restore_stock_tx(uuid, uuid, uuid, uuid, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.void_order_and_restore_stock_tx(uuid, uuid, uuid, uuid, text, boolean) TO service_role;
