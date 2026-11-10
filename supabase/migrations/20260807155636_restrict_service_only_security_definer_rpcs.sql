-- Restrict privileged public RPC wrappers to trusted server/service-role callers.
-- Function bodies and business semantics are unchanged.

revoke all on function public.cleanup_pos_runtime_data(integer, integer, integer) from public;
revoke execute on function public.cleanup_pos_runtime_data(integer, integer, integer) from anon, authenticated;
grant execute on function public.cleanup_pos_runtime_data(integer, integer, integer) to service_role;

revoke all on function public.complete_pos_payment_tx(uuid, uuid, uuid, uuid, jsonb, text) from public;
revoke execute on function public.complete_pos_payment_tx(uuid, uuid, uuid, uuid, jsonb, text) from anon, authenticated;
grant execute on function public.complete_pos_payment_tx(uuid, uuid, uuid, uuid, jsonb, text) to service_role;

revoke all on function public.configure_staff_cancel_bill_approval(uuid, uuid, uuid, boolean, text, uuid) from public;
revoke execute on function public.configure_staff_cancel_bill_approval(uuid, uuid, uuid, boolean, text, uuid) from anon, authenticated;
grant execute on function public.configure_staff_cancel_bill_approval(uuid, uuid, uuid, boolean, text, uuid) to service_role;

revoke all on function public.create_manual_delivery_order_tx(uuid, uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, jsonb, text, text) from public;
revoke execute on function public.create_manual_delivery_order_tx(uuid, uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, jsonb, text, text) from anon, authenticated;
grant execute on function public.create_manual_delivery_order_tx(uuid, uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, jsonb, text, text) to service_role;

revoke all on function public.create_pos_order_tx(uuid, uuid, uuid, uuid, public.order_type, text, uuid, text, text, text, numeric, numeric, numeric, jsonb, text, text) from public;
revoke execute on function public.create_pos_order_tx(uuid, uuid, uuid, uuid, public.order_type, text, uuid, text, text, text, numeric, numeric, numeric, jsonb, text, text) from anon, authenticated;
grant execute on function public.create_pos_order_tx(uuid, uuid, uuid, uuid, public.order_type, text, uuid, text, text, text, numeric, numeric, numeric, jsonb, text, text) to service_role;

revoke all on function public.create_pos_order_tx(uuid, uuid, uuid, uuid, public.order_type, text, uuid, text, text, text, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, jsonb, text, text) from public;
revoke execute on function public.create_pos_order_tx(uuid, uuid, uuid, uuid, public.order_type, text, uuid, text, text, text, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, jsonb, text, text) from anon, authenticated;
grant execute on function public.create_pos_order_tx(uuid, uuid, uuid, uuid, public.order_type, text, uuid, text, text, text, numeric, numeric, numeric, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text, jsonb, text, text) to service_role;

revoke all on function public.create_stock_adjustment_tx(uuid, uuid, uuid, numeric, text, uuid, uuid, text) from public;
revoke execute on function public.create_stock_adjustment_tx(uuid, uuid, uuid, numeric, text, uuid, uuid, text) from anon, authenticated;
grant execute on function public.create_stock_adjustment_tx(uuid, uuid, uuid, numeric, text, uuid, uuid, text) to service_role;

revoke all on function public.deduct_order_recipe_stock(uuid, uuid, uuid, text, uuid, text, text) from public;
revoke execute on function public.deduct_order_recipe_stock(uuid, uuid, uuid, text, uuid, text, text) from anon, authenticated;
grant execute on function public.deduct_order_recipe_stock(uuid, uuid, uuid, text, uuid, text, text) to service_role;

revoke all on function public.mobile_takeaway_checkout_bill(uuid, uuid, uuid, uuid, text, uuid, text, numeric, text, text, numeric, jsonb) from public;
revoke execute on function public.mobile_takeaway_checkout_bill(uuid, uuid, uuid, uuid, text, uuid, text, numeric, text, text, numeric, jsonb) from anon, authenticated;
grant execute on function public.mobile_takeaway_checkout_bill(uuid, uuid, uuid, uuid, text, uuid, text, numeric, text, text, numeric, jsonb) to service_role;

-- Fresh replay may not include this optional RPC (it was present in an
-- earlier hosted deployment but is not created by the preceding migrations).
-- Apply least-privilege grants only when that exact signature exists.
do $guard$
begin
  if to_regprocedure('public.mobile_takeaway_hold_bill(uuid, uuid, uuid, uuid, uuid, text, numeric, jsonb)') is not null then
    revoke all on function public.mobile_takeaway_hold_bill(uuid, uuid, uuid, uuid, uuid, text, numeric, jsonb) from public;
    revoke execute on function public.mobile_takeaway_hold_bill(uuid, uuid, uuid, uuid, uuid, text, numeric, jsonb) from anon, authenticated;
    grant execute on function public.mobile_takeaway_hold_bill(uuid, uuid, uuid, uuid, uuid, text, numeric, jsonb) to service_role;
  end if;
end;
$guard$;

revoke all on function public.next_pos_order_no(uuid, uuid, text) from public;
revoke execute on function public.next_pos_order_no(uuid, uuid, text) from anon, authenticated;
grant execute on function public.next_pos_order_no(uuid, uuid, text) to service_role;

-- This optional hosted-only helper is absent from a clean migration replay.
-- If installed, retain the existing restriction; never create a privileged stub.
do $rlsguard$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke all on function public.rls_auto_enable() from public;
    revoke execute on function public.rls_auto_enable() from anon, authenticated;
  end if;
end;
$rlsguard$;
