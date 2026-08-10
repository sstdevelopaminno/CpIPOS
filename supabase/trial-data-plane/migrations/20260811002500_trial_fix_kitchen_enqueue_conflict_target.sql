-- Trial mirror: fix PL/pgSQL ambiguity in app.enqueue_kitchen_order ON CONFLICT target.
-- The function RETURNS TABLE(kitchen_ticket_id, ...), so the bare column name
-- kitchen_ticket_id inside ON CONFLICT can resolve ambiguously at runtime.

do $$
declare
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('app.enqueue_kitchen_order(uuid,uuid,uuid,text,text,uuid[])'::regprocedure)
    into v_old;

  v_new := regexp_replace(
    v_old,
    'on[[:space:]]+conflict[[:space:]]*\([[:space:]]*kitchen_ticket_id[[:space:]]*,[[:space:]]*order_item_id[[:space:]]*,[[:space:]]*action[[:space:]]*\)[[:space:]]+do[[:space:]]+nothing',
    'on conflict on constraint kitchen_ticket_items_kitchen_ticket_id_order_item_id_action_key do nothing',
    'i'
  );

  if v_new = v_old then
    raise exception 'KITCHEN_ENQUEUE_CONFLICT_TARGET_PATTERN_NOT_FOUND';
  end if;

  execute v_new;
end;
$$;

notify pgrst, 'reload schema';
