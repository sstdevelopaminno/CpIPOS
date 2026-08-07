-- Pin app function search_path to prevent object shadowing while preserving existing resolution.
-- No function body, trigger, privilege, or business-rule changes.

alter function app.touch_updated_at()
  set search_path = pg_catalog, public, app, extensions;

alter function app.consume_ingredient(uuid, uuid, uuid, numeric, public.order_type, uuid, uuid)
  set search_path = pg_catalog, public, app, extensions;

alter function app.enforce_stock_adjustment_approval()
  set search_path = pg_catalog, public, app, extensions;

alter function app.current_user_id()
  set search_path = pg_catalog, public, app, extensions;

alter function app.enforce_shift_close_rules()
  set search_path = pg_catalog, public, app, extensions;

alter function app.next_dining_table_code(uuid, uuid)
  set search_path = pg_catalog, public, app, extensions;

alter function app.enforce_order_cancellation_approval()
  set search_path = pg_catalog, public, app, extensions;

alter function app.revoke_staff_approval_on_role_change()
  set search_path = pg_catalog, public, app, extensions;

alter function app.enforce_approval_approver_role()
  set search_path = pg_catalog, public, app, extensions;
