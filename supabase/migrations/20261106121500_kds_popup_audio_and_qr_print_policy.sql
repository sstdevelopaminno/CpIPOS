-- Per-branch KDS alerts (cashier and QR) and QR cashier approval preference.
-- NULL review preference preserves each shop's existing product-profile behavior.
ALTER TABLE public.tenant_pos_notification_settings
  ADD COLUMN IF NOT EXISTS table_qr_cashier_review_required boolean DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS kitchen_alert_popup_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS kitchen_alert_sound_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS kitchen_alert_sound_volume numeric(4,2) NOT NULL DEFAULT 1.00;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_pos_notification_settings_kds_sound_volume_check'
      AND conrelid = 'public.tenant_pos_notification_settings'::regclass
  ) THEN
    ALTER TABLE public.tenant_pos_notification_settings
      ADD CONSTRAINT tenant_pos_notification_settings_kds_sound_volume_check
      CHECK (kitchen_alert_sound_volume >= 0 AND kitchen_alert_sound_volume <= 1);
  END IF;
END $$;

-- app.enqueue_kitchen_order may enqueue print_jobs inside its SQL transaction
-- before application-side policy checks. Reject *only* automatic table QR jobs
-- when print is disabled; preserve kitchen tickets and manual reprint jobs.
CREATE OR REPLACE FUNCTION app.guard_automatic_table_qr_kitchen_print()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
DECLARE
  v_channel text;
  v_store_enabled boolean;
  v_override text;
BEGIN
  IF NEW.printer_role IS DISTINCT FROM 'kitchen'
      OR NEW.metadata->>'source' IS DISTINCT FROM 'app.enqueue_kitchen_order'
      OR lower(coalesce(NEW.payload_json->>'event_type','')) = 'reprint' THEN
    RETURN NEW;
  END IF;

  SELECT o.channel INTO v_channel
  FROM public.orders o
  WHERE o.id = NEW.order_id
    AND o.tenant_id = NEW.tenant_id
    AND o.branch_id = NEW.branch_id;
  IF v_channel IS DISTINCT FROM 'table_qr' THEN RETURN NEW; END IF;

  SELECT s.table_qr_kitchen_auto_print_enabled, s.table_qr_kitchen_auto_print_override
    INTO v_store_enabled, v_override
  FROM public.tenant_pos_notification_settings s
  WHERE s.tenant_id = NEW.tenant_id AND s.branch_id = NEW.branch_id;

  IF NOT FOUND THEN RETURN NEW; END IF;
  IF v_override = 'force_off' OR
     (coalesce(v_override, 'inherit') <> 'force_on' AND NOT coalesce(v_store_enabled, true)) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_automatic_table_qr_kitchen_print ON public.print_jobs;
CREATE TRIGGER trg_guard_automatic_table_qr_kitchen_print
  BEFORE INSERT ON public.print_jobs
  FOR EACH ROW EXECUTE FUNCTION app.guard_automatic_table_qr_kitchen_print();

REVOKE ALL ON FUNCTION app.guard_automatic_table_qr_kitchen_print() FROM PUBLIC, anon, authenticated;
