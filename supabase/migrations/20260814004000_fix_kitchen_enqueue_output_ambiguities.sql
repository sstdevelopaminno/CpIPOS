-- Fix PL/pgSQL OUT-parameter name collisions in the K1 kitchen enqueue function.
-- `queue_no`, `round_no`, and `kitchen_ticket_id` are RETURNS TABLE output names,
-- so unqualified column references can become ambiguous at runtime.
-- Keep the public function contract and routing behavior unchanged.

do $do$
declare
  v_sql text;
begin
  v_sql := pg_get_functiondef(
    'app.enqueue_kitchen_order(uuid,uuid,uuid,text,text,uuid[])'::regprocedure
  );

  v_sql := replace(
    v_sql,
    'insert into public.kitchen_tickets(',
    'insert into public.kitchen_tickets as inserted_ticket('
  );

  v_sql := replace(
    v_sql,
    'returning id, queue_no, round_no into v_ticket_id, v_order_queue_no, v_round_no',
    'returning inserted_ticket.id, inserted_ticket.queue_no, inserted_ticket.round_no into v_ticket_id, v_order_queue_no, v_round_no'
  );

  v_sql := replace(
    v_sql,
    'on conflict (kitchen_ticket_id, order_item_id, action) do nothing',
    'on conflict on constraint kitchen_ticket_items_kitchen_ticket_id_order_item_id_action_key do nothing'
  );

  execute v_sql;
end
$do$;
