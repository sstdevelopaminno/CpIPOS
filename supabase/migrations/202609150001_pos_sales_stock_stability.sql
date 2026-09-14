-- POS sales / stock stability hardening.
-- 1) Allow owner/manager sessions to coexist with a cashier on the same device.
-- 2) Restore ingredient stock exactly once when a bill is voided/cancelled.
-- 3) Add a status/date index for sales reporting across busy branches.

DROP INDEX IF EXISTS public.uq_pos_sessions_device_code_active_scope;
DROP INDEX IF EXISTS public.uq_pos_sessions_device_id_active_scope;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_sessions_device_code_active_scope
  ON public.pos_sessions (tenant_id, branch_id, upper(device_code))
  WHERE status = 'active'
    AND device_code IS NOT NULL
    AND role NOT IN ('owner', 'manager');

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_sessions_device_id_active_scope
  ON public.pos_sessions (tenant_id, branch_id, device_id)
  WHERE status = 'active'
    AND device_id IS NOT NULL
    AND role NOT IN ('owner', 'manager');

CREATE INDEX IF NOT EXISTS idx_orders_scope_status_created
  ON public.orders (tenant_id, branch_id, status, created_at DESC);

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

  -- Restore from the immutable sale-deduction ledger instead of recalculating
  -- current recipes. This remains correct even if a recipe was edited later.
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

    -- The order row lock serializes all cancellation attempts for the same bill;
    -- the request-id unique index is an additional idempotency barrier.
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
        'manual_adjustment',
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

  v_metadata := coalesce(v_order.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'stock_restored_at', v_now,
      'stock_restored_by', p_actor_user_id,
      'stock_restore_version', 1
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

CREATE OR REPLACE FUNCTION public.void_order_and_restore_stock_tx(
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
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'app', 'extensions'
SET lock_timeout TO '5s'
AS $function$
  SELECT *
    FROM app.void_order_and_restore_stock_tx(
      p_tenant_id,
      p_branch_id,
      p_order_id,
      p_actor_user_id,
      p_reason,
      p_mark_deleted
    );
$function$;

REVOKE ALL ON FUNCTION public.void_order_and_restore_stock_tx(uuid, uuid, uuid, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_order_and_restore_stock_tx(uuid, uuid, uuid, uuid, text, boolean) TO service_role;
