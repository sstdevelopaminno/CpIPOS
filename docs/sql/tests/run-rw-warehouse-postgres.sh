#!/usr/bin/env bash
set -euo pipefail
test "${PGHOST:-}" = "127.0.0.1"
test "${PGDATABASE:-}" = "rw_warehouse_test"
PSQL=(psql -X -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f docs/sql/tests/rw-warehouse-fixture.sql
for file in rw-warehouse-schema rw-branch-adjustment rw-warehouse-inbound rw-warehouse-draft rw-warehouse-transfer-approval rw-warehouse-pin-adapter rw-warehouse-dispatch rw-warehouse-receive; do
  "${PSQL[@]}" -f "docs/sql/${file}-candidate.sql"
done
"${PSQL[@]}" -f docs/sql/tests/rw-warehouse-assertions.sql
# Separate connections. Simulate the existing POS delta writer holding a row lock.
# Receipt must wait and apply its delta to the updated quantity, not a stale snapshot.
PGAPPNAME=rw_test_sale "${PSQL[@]}" <<'SQL' &
begin;
update public.ingredients set quantity_on_hand=quantity_on_hand-4
 where id='00000000-0000-0000-0000-000000000051';
select pg_sleep(5);
commit;
SQL
sale_pid=$!
trap 'kill "$sale_pid" 2>/dev/null || true' EXIT
ready=0
for attempt in {1..40}; do
  if [[ "$("${PSQL[@]}" -Atc "select count(*) from pg_stat_activity where application_name='rw_test_sale' and wait_event='PgSleep'")" = "1" ]]; then
    ready=1; break
  fi
  sleep 0.1
done
test "$ready" = "1"
PGAPPNAME=rw_test_receipt "${PSQL[@]}" -c "set role service_role; select public.rw_receive_candidate('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000072','00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000122','A',2)" &
receipt_pid=$!
wait "$sale_pid"
wait "$receipt_pid"
trap - EXIT
"${PSQL[@]}" <<'SQL'
do $$ begin
  if (select quantity_on_hand from public.ingredients where id='00000000-0000-0000-0000-000000000051') <> 13 then
    raise exception 'CONCURRENT_SALE_RECEIPT_LOST_UPDATE';
  end if;
end $$;
select 'CONCURRENT SALE / RECEIPT PASSED';
SQL
