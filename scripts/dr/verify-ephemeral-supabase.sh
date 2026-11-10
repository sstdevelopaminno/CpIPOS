#!/usr/bin/env bash
# Only the ephemeral database on the GitHub runner. Never accept a remote host URL.
set -euo pipefail
export PGPASSWORD=postgres
PSQL=(psql -X -qAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres)
if ! command -v psql >/dev/null; then
  echo "::error::psql client missing on runner."
  exit 1
fi
table_exists="$("${PSQL[@]}" -c "select to_regclass('public.tenants') is not null")"
if [[ "$table_exists" != "t" ]]; then
  echo "::error::Local migrations did not create public.tenants."
  exit 1
fi
tenant_count="$("${PSQL[@]}" -c "select count(*) from public.tenants")"
if [[ "$tenant_count" != "0" ]]; then
  echo "::error::Local default seed unexpectedly created a tenant. Refuse use as clean DR sandbox."
  exit 1
fi
rls="$("${PSQL[@]}" -c "select relrowsecurity from pg_class where oid='public.tenants'::regclass")"
if [[ "$rls" != "t" ]]; then
  echo "::error::Local public.tenants RLS is disabled."
  exit 1
fi
migration_files="$(find supabase/migrations -name '*.sql' -type f | wc -l | tr -d ' ')"
if [[ "$migration_files" -lt 200 ]]; then
  echo "::error::Unexpectedly few migration files. Refuse accepting incomplete schema."
  exit 1
fi
echo "EPHEMERAL_SUPABASE_SCHEMA_READY"
echo "Local-only migrations: $migration_files; default tenant count: $tenant_count; tenants RLS: enabled."
echo "No cloud credentials, customer tenant records, paid branches or persistent cloud staging created."
