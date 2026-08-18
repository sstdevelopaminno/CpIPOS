-- Keep every kitchen round for the same order on the original queue number.
-- A miss on a new event_key must not clear v_order_queue_no before INSERT.

do $migration$
declare
  v_oid oid;
  v_ddl text;
  v_old text := 'select kt\.id, kt\.queue_no, kt\.round_no into v_ticket_id, v_order_queue_no, v_round_no';
  v_new text := 'select kt.id, kt.round_no into v_ticket_id, v_round_no';
  v_before integer;
  v_after integer;
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
  v_before := (
    length(v_ddl) - length(replace(
      v_ddl,
      'select kt.id, kt.queue_no, kt.round_no into v_ticket_id, v_order_queue_no, v_round_no',
      ''
    ))
  ) / length('select kt.id, kt.queue_no, kt.round_no into v_ticket_id, v_order_queue_no, v_round_no');

  if v_before < 3 then
    raise exception 'unexpected_queue_select_count:%', v_before;
  end if;

  -- Rewrite event-key lookup and reprint lookup only. The post-insert fallback
  -- must still read the persisted queue_no back from the existing ticket.
  v_ddl := regexp_replace(v_ddl, v_old, v_new);
  v_ddl := regexp_replace(v_ddl, v_old, v_new);

  v_after := (
    length(v_ddl) - length(replace(
      v_ddl,
      'select kt.id, kt.queue_no, kt.round_no into v_ticket_id, v_order_queue_no, v_round_no',
      ''
    ))
  ) / length('select kt.id, kt.queue_no, kt.round_no into v_ticket_id, v_order_queue_no, v_round_no');

  if v_after <> v_before - 2 then
    raise exception 'queue_select_rewrite_failed:%->%', v_before, v_after;
  end if;

  execute v_ddl;
end
$migration$;
