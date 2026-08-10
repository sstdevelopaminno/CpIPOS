-- Fix runtime ambiguity in app.submit_table_qr_order_tx caused by RETURNS TABLE
-- output variables (for example table_id/order_id) sharing names with table columns.
-- Prefer SQL table columns for ambiguous references inside this legacy function.

do $$
declare
  v_old text;
  v_new text;
begin
  select pg_get_functiondef('app.submit_table_qr_order_tx(uuid,text,jsonb,text)'::regprocedure)
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
    raise exception 'TABLE_QR_FUNCTION_BODY_MARKER_NOT_FOUND';
  end if;

  execute v_new;
end;
$$;

notify pgrst, 'reload schema';
