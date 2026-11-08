-- Trial data-plane: transactional kitchen guard mirrors main DB.
-- Flag is retrieved from the authoritative primary tenant settings and passed by the API.
-- POS-only kitchen confirmation guard. Kitchen-side line cancellation retains
-- its existing RPC; cashier edits and voids must use these guarded RPCs.
-- p_lock_confirmed_items comes from the authoritative primary-DB branch setting.
CREATE OR REPLACE FUNCTION app.replace_queued_dine_in_order_pos_guarded_tx(
  p_tenant_id uuid, p_branch_id uuid, p_shift_id uuid,
  p_actor_user_id uuid, p_order_id uuid, p_table_id uuid,
  p_items jsonb, p_app_total_amount numeric,
  p_discount_amount numeric DEFAULT 0, p_gp_amount numeric DEFAULT 0,
  p_tax_total numeric DEFAULT 0, p_grand_total numeric DEFAULT NULL,
  p_tax_lines jsonb DEFAULT '[]'::jsonb,
  p_lock_confirmed_items boolean DEFAULT true
)
RETURNS TABLE(order_id uuid, order_no text, order_status text, created_at timestamptz, total_amount numeric)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'app', 'extensions'
AS $function$
BEGIN
  IF p_lock_confirmed_items THEN
    -- Serialize competing cashier edits of the same bill.
    PERFORM 1 FROM public.table_bill_sessions s
     WHERE s.tenant_id = p_tenant_id AND s.branch_id = p_branch_id
       AND s.table_id = p_table_id AND s.closed_at IS NULL
       AND s.status IN ('open', 'ordering')
     ORDER BY s.opened_at DESC LIMIT 1 FOR UPDATE;
    PERFORM 1 FROM public.orders o
     WHERE o.id = p_order_id AND o.tenant_id = p_tenant_id
       AND o.branch_id = p_branch_id AND o.table_id = p_table_id FOR UPDATE;

    -- Preserve confirmed quantities by product+notes. A new unconfirmed line
    -- can still be added; unconfirmed lines with other keys remain editable.
    IF EXISTS (
      WITH confirmed_lines AS (
        SELECT DISTINCT oi.id, oi.product_id, COALESCE(BTRIM(oi.notes), '') AS notes_key, oi.quantity
          FROM public.order_items oi
          JOIN public.kitchen_ticket_items kti
            ON kti.order_item_id = oi.id AND kti.tenant_id = oi.tenant_id AND kti.branch_id = oi.branch_id
          JOIN public.kitchen_tickets kt
            ON kt.id = kti.kitchen_ticket_id AND kt.tenant_id = oi.tenant_id AND kt.branch_id = oi.branch_id
         WHERE oi.order_id = p_order_id AND oi.tenant_id = p_tenant_id AND oi.branch_id = p_branch_id
           AND oi.quantity > 0 AND COALESCE(oi.metadata->>'bill_line_state', 'active') <> 'cancelled'
           AND kt.status IN ('acknowledged', 'preparing', 'ready')
           AND kti.action <> 'cancel' AND COALESCE((kti.metadata->>'kds_line_cancelled')::boolean, false) = false
      ),
      confirmed AS (
        SELECT product_id, notes_key, SUM(quantity) AS min_quantity
        FROM confirmed_lines GROUP BY product_id, notes_key
      ),
      desired AS (
        SELECT NULLIF(item->>'product_id', '')::uuid AS product_id,
               COALESCE(NULLIF(LEFT(BTRIM(COALESCE(item->>'notes', item->>'note', '')), 240), ''), '') AS notes_key,
               SUM(COALESCE(NULLIF(item->>'quantity', '')::numeric, 0)) AS quantity
        FROM jsonb_array_elements(p_items) item GROUP BY 1, 2
      )
      SELECT 1 FROM confirmed c LEFT JOIN desired d
        ON d.product_id = c.product_id AND d.notes_key = c.notes_key
      WHERE COALESCE(d.quantity, 0) < c.min_quantity
    ) THEN
      RAISE EXCEPTION 'KITCHEN_CONFIRMED_ITEM_LOCKED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN QUERY SELECT * FROM app.replace_queued_dine_in_order_tx(
    p_tenant_id, p_branch_id, p_shift_id, p_actor_user_id, p_order_id, p_table_id,
    p_items, p_app_total_amount, p_discount_amount, p_gp_amount,
    p_tax_total, p_grand_total, p_tax_lines
  );
END;
$function$;

REVOKE ALL ON FUNCTION app.replace_queued_dine_in_order_pos_guarded_tx(
  uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,numeric,numeric,numeric,numeric,jsonb,boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.replace_queued_dine_in_order_pos_guarded_tx(
  uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,numeric,numeric,numeric,numeric,jsonb,boolean
) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_queued_pos_order_kitchen_guarded_tx(
  p_tenant_id uuid, p_branch_id uuid, p_order_id uuid,
  p_actor_user_id uuid, p_approval_id uuid, p_reason text,
  p_lock_confirmed_items boolean DEFAULT true
)
RETURNS TABLE (
  id uuid, order_no text, status text, cancelled_reason text,
  updated_at timestamptz, table_id uuid,
  restored_ingredient_count integer, restored_quantity numeric,
  table_session_closed_count integer, table_released boolean
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'app', 'extensions'
AS $function$
DECLARE v_order_type text;
BEGIN
  IF p_lock_confirmed_items THEN
    SELECT o.order_type::text INTO v_order_type FROM public.orders o
     WHERE o.id = p_order_id AND o.tenant_id = p_tenant_id AND o.branch_id = p_branch_id
     FOR UPDATE;
    IF v_order_type = 'dine_in' AND EXISTS (
      SELECT 1 FROM public.order_items oi
      JOIN public.kitchen_ticket_items kti
        ON kti.order_item_id = oi.id AND kti.tenant_id = oi.tenant_id AND kti.branch_id = oi.branch_id
      JOIN public.kitchen_tickets kt
        ON kt.id = kti.kitchen_ticket_id AND kt.tenant_id = oi.tenant_id AND kt.branch_id = oi.branch_id
      WHERE oi.order_id = p_order_id AND oi.tenant_id = p_tenant_id AND oi.branch_id = p_branch_id
        AND oi.quantity > 0 AND COALESCE(oi.metadata->>'bill_line_state', 'active') <> 'cancelled'
        AND kt.status IN ('acknowledged', 'preparing', 'ready')
        AND kti.action <> 'cancel' AND COALESCE((kti.metadata->>'kds_line_cancelled')::boolean, false) = false
    ) THEN
      RAISE EXCEPTION 'KITCHEN_CONFIRMED_ITEM_LOCKED' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN QUERY SELECT * FROM public.cancel_queued_pos_order_and_restore_stock_tx(
    p_tenant_id, p_branch_id, p_order_id, p_actor_user_id, p_approval_id, p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_queued_pos_order_kitchen_guarded_tx(
  uuid,uuid,uuid,uuid,uuid,text,boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_queued_pos_order_kitchen_guarded_tx(
  uuid,uuid,uuid,uuid,uuid,text,boolean
) TO service_role;
