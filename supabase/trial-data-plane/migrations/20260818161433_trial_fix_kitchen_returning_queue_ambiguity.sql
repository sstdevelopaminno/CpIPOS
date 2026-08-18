-- Trial parity hardening.
-- RETURNS TABLE exposes queue_no/round_no as PL/pgSQL variables, so the
-- INSERT ... RETURNING columns must be qualified with the target alias.

do $migration$
declare
  v_oid oid;
  v_ddl text;
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

  if position('returning id, queue_no, round_no' in v_ddl) > 0 then
    if position('insert into public.kitchen_tickets as inserted_ticket' in v_ddl) = 0 then
      v_ddl := replace(
        v_ddl,
        'insert into public.kitchen_tickets(',
        'insert into public.kitchen_tickets as inserted_ticket('
      );
    end if;

    v_ddl := replace(
      v_ddl,
      'returning id, queue_no, round_no',
      'returning inserted_ticket.id, inserted_ticket.queue_no, inserted_ticket.round_no'
    );

    execute v_ddl;
  end if;
end
$migration$;
