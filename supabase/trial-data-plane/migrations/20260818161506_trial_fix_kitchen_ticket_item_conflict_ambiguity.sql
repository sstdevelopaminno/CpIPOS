-- Trial parity hardening.
-- Avoid PL/pgSQL output-variable ambiguity in ON CONFLICT column inference.

do $migration$
declare
  v_oid oid;
  v_ddl text;
  v_old text := 'on conflict (kitchen_ticket_id, order_item_id, action) do nothing';
  v_new text := 'on conflict on constraint kitchen_ticket_items_kitchen_ticket_id_order_item_id_action_key do nothing';
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app'
    and p.proname = 'enqueue_kitchen_order'
    and pg_get_function_identity_arguments(p.oid) =
      'p_tenant_id uuid, p_branch_id uuid, p_order_id uuid, p_event_key text, p_action text, p_order_item_ids uuid[]';

  if v_oid is null then
    raise exception 'enqueue_kitchen_order_not_found';
  end if;

  v_ddl := pg_get_functiondef(v_oid);
  if position(v_old in v_ddl) > 0 then
    v_ddl := replace(v_ddl, v_old, v_new);
    execute v_ddl;
  end if;
end
$migration$;
