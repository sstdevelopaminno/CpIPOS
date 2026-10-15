#!/usr/bin/env bash
# Isolated synthetic PostgreSQL Docker service ONLY. No Supabase production URLs.
set -euo pipefail

tenant=00000000-0000-4000-8000-000000000001
branch=00000000-0000-4000-8000-000000000011
actor=00000000-0000-4000-8000-000000000101
customer=00000000-0000-4000-8000-000000000301
product=00000000-0000-4000-8000-000000000201
shift=00000000-0000-4000-8000-000000000401

work_order="$(psql -v ON_ERROR_STOP=1 -Atqc "
set role service_role;
select work_order_id from public.optical_create_work_order_tx(
 '$tenant'::uuid,'$branch'::uuid,'$actor'::uuid,'$actor'::uuid,'$customer'::uuid,
 null,jsonb_build_array(jsonb_build_object('product_id','$product','quantity',1)),
 0,'00000000-0000-4000-8000-000000000609'::uuid,null,null
);")"
work_order="$(printf '%s\n' "$work_order" | tail -n 1)"
if [[ ! "$work_order" =~ ^[a-f0-9-]{36}$ ]]; then
  echo "Synthetic order creation failed: $work_order" >&2
  exit 1
fi

pay_one() {
  local id="$1"
  local log="$2"
  psql -v ON_ERROR_STOP=1 -Atqc "
    set role service_role;
    select payment_id from public.optical_post_deposit_tx(
      '$tenant'::uuid,'$branch'::uuid,'$work_order'::uuid,'$actor'::uuid,
      '$shift'::uuid,'$id'::uuid,700,'cash',null,null
    );" >"$log" 2>&1
}

pay_one "00000000-0000-4000-8000-000000000711" /tmp/optical-pay-one.log &
a=$!
pay_one "00000000-0000-4000-8000-000000000712" /tmp/optical-pay-two.log &
b=$!
sa=0; sb=0
wait "$a" || sa=$?
wait "$b" || sb=$?
if [[ $sa -eq 0 && $sb -eq 0 || $sa -ne 0 && $sb -ne 0 ]]; then
  echo "Expected exactly one successful concurrent payment: statuses $sa, $sb" >&2
  cat /tmp/optical-pay-one.log /tmp/optical-pay-two.log >&2
  exit 1
fi
if ! grep -q "OPTICAL_PAYMENT_AMOUNT_INVALID" /tmp/optical-pay-one.log &&
   ! grep -q "OPTICAL_PAYMENT_AMOUNT_INVALID" /tmp/optical-pay-two.log; then
  echo "Unexpected concurrent loser error" >&2
  cat /tmp/optical-pay-one.log /tmp/optical-pay-two.log >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 -v oid="$work_order" <<'SQL'
select set_config('optical.test_work_order_id', :'oid', false);
do $verify$
declare
  v_order uuid := current_setting('optical.test_work_order_id')::uuid;
  v_paid numeric;
  v_count integer;
begin
  select paid_total into v_paid from public.optical_work_orders where id=v_order;
  select count(*) into v_count from public.optical_payment_ledger where work_order_id=v_order;
  if v_paid<>700 or v_count<>1 then
    raise exception 'concurrent payment double posted: paid %, count %',v_paid,v_count;
  end if;
end
$verify$;
SQL

echo "Optical concurrency: one 700 LAK payment persisted, overpayment request rejected"
