do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.prosecdef = true
      and p.proname in (
        'complete_pos_payment_tx',
        'configure_staff_cancel_bill_approval',
        'create_manual_delivery_order_tx',
        'create_pos_order_tx',
        'create_stock_adjustment_tx',
        'revoke_table_qr_session_on_bill_close'
      )
  loop
    execute format('revoke execute on function %I.%I(%s) from public, anon, authenticated', r.nspname, r.proname, r.identity_args);
    execute format('grant execute on function %I.%I(%s) to service_role', r.nspname, r.proname, r.identity_args);
  end loop;
end $$;
