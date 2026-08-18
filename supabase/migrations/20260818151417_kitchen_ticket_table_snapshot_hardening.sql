create or replace function app.snapshot_kitchen_ticket_table_identity()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog','public','app'
as $function$
declare
  v_table_code text;
  v_table_name text;
  v_table_label text;
begin
  if new.table_id is null then
    return new;
  end if;

  select nullif(btrim(dt.table_code), ''), nullif(btrim(dt.table_name), '')
    into v_table_code, v_table_name
  from public.dining_tables dt
  where dt.id = new.table_id
    and dt.tenant_id = new.tenant_id
    and dt.branch_id = new.branch_id;

  if not found then
    raise exception 'KITCHEN_TICKET_TABLE_SCOPE_MISMATCH';
  end if;

  v_table_label := case
    when v_table_code is not null and v_table_name is not null and v_table_name <> v_table_code then v_table_code || ' · ' || v_table_name
    else coalesce(v_table_code, v_table_name)
  end;

  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'table_id', new.table_id,
    'table_code', v_table_code,
    'table_name', v_table_name,
    'table_label', v_table_label,
    'table_snapshot_at', now()
  );
  return new;
end;
$function$;

revoke all on function app.snapshot_kitchen_ticket_table_identity() from public;

drop trigger if exists trg_kitchen_ticket_table_snapshot on public.kitchen_tickets;
create trigger trg_kitchen_ticket_table_snapshot
before insert on public.kitchen_tickets
for each row execute function app.snapshot_kitchen_ticket_table_identity();

update public.kitchen_tickets kt
set metadata = coalesce(kt.metadata, '{}'::jsonb) || jsonb_build_object(
  'table_id', kt.table_id,
  'table_code', nullif(btrim(dt.table_code), ''),
  'table_name', nullif(btrim(dt.table_name), ''),
  'table_label', case
    when nullif(btrim(dt.table_code), '') is not null
      and nullif(btrim(dt.table_name), '') is not null
      and btrim(dt.table_name) <> btrim(dt.table_code)
      then btrim(dt.table_code) || ' · ' || btrim(dt.table_name)
    else coalesce(nullif(btrim(dt.table_code), ''), nullif(btrim(dt.table_name), ''))
  end,
  'table_snapshot_at', coalesce(kt.created_at, now())
)
from public.dining_tables dt
where kt.table_id is not null
  and dt.id = kt.table_id
  and dt.tenant_id = kt.tenant_id
  and dt.branch_id = kt.branch_id
  and coalesce(kt.metadata->>'table_label','') = '';
