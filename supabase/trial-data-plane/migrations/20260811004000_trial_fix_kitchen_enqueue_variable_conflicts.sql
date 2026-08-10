-- Trial: prefer table columns when app.enqueue_kitchen_order output variables
-- (kitchen_ticket_id, zone_id, print_job_id) share names with SQL columns.

do $$
declare
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('app.enqueue_kitchen_order(uuid,uuid,uuid,text,text,uuid[])'::regprocedure)
    into v_old;

  if position('#variable_conflict use_column' in v_old) > 0 then
    return;
  end if;

  v_new := replace(
    v_old,
    'AS $function$' || chr(10),
    'AS $function$' || chr(10) || '#variable_conflict use_column' || chr(10)
  );

  if v_new = v_old then
    raise exception 'TRIAL_KITCHEN_ENQUEUE_BODY_MARKER_NOT_FOUND';
  end if;

  execute v_new;
end;
$$;

notify pgrst, 'reload schema';
