alter table public.pos_device_incidents
  add column if not exists occurrence_count integer not null default 1
    check (occurrence_count >= 1),
  add column if not exists last_seen_at timestamptz;

update public.pos_device_incidents
set last_seen_at = coalesce(last_seen_at, resolved_at, detected_at, created_at)
where last_seen_at is null;

with grouped as (
  select
    tenant_id, branch_id, device_code, machine_id, code,
    (array_agg(id order by detected_at asc, id asc))[1] as keeper_id,
    count(*)::integer as total_occurrences,
    min(detected_at) as first_seen,
    max(coalesce(last_seen_at, detected_at)) as last_seen
  from public.pos_device_incidents
  where resolved_at is null
  group by tenant_id, branch_id, device_code, machine_id, code
  having count(*) > 1
),
updated as (
  update public.pos_device_incidents i
  set occurrence_count = greatest(i.occurrence_count, g.total_occurrences),
      detected_at = least(i.detected_at, g.first_seen),
      last_seen_at = greatest(coalesce(i.last_seen_at, i.detected_at), g.last_seen)
  from grouped g
  where i.id = g.keeper_id
  returning i.id
)
delete from public.pos_device_incidents i
using grouped g
where i.tenant_id = g.tenant_id
  and i.branch_id = g.branch_id
  and i.device_code = g.device_code
  and i.machine_id = g.machine_id
  and i.code = g.code
  and i.resolved_at is null
  and i.id <> g.keeper_id;

create unique index if not exists pos_device_incidents_one_active_code_idx
  on public.pos_device_incidents(tenant_id, branch_id, device_code, machine_id, code)
  where resolved_at is null;

create or replace function public.record_pos_device_incidents(
  p_latest_id uuid,
  p_snapshot_id uuid,
  p_tenant_id uuid,
  p_branch_id uuid,
  p_pos_device_id uuid,
  p_pos_session_id uuid,
  p_device_code text,
  p_machine_id text,
  p_incidents jsonb,
  p_captured_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_incident jsonb;
  v_codes text[] := array[]::text[];
  v_code text;
  v_resolved integer := 0;
  v_active integer := 0;
begin
  if p_tenant_id is null or p_branch_id is null then
    raise exception 'incident_scope_required';
  end if;
  if nullif(btrim(coalesce(p_device_code,'')),'') is null
     or nullif(btrim(coalesce(p_machine_id,'')),'') is null then
    raise exception 'incident_device_identity_required';
  end if;
  if jsonb_typeof(coalesce(p_incidents,'[]'::jsonb)) <> 'array' then
    raise exception 'incident_payload_must_be_array';
  end if;

  select coalesce(array_agg(distinct code_value), array[]::text[])
  into v_codes
  from (
    select nullif(btrim(value->>'code'),'') as code_value
    from jsonb_array_elements(coalesce(p_incidents,'[]'::jsonb))
  ) q
  where code_value is not null;

  update public.pos_device_incidents i
  set resolved_at = coalesce(p_captured_at, now()),
      last_seen_at = greatest(
        coalesce(i.last_seen_at, i.detected_at),
        coalesce(p_captured_at, now())
      )
  where i.tenant_id = p_tenant_id
    and i.branch_id = p_branch_id
    and i.device_code = p_device_code
    and i.machine_id = p_machine_id
    and i.resolved_at is null
    and not (i.code = any(v_codes));
  get diagnostics v_resolved = row_count;

  for v_incident in
    select value
    from jsonb_array_elements(coalesce(p_incidents,'[]'::jsonb))
  loop
    v_code := nullif(btrim(v_incident->>'code'),'');
    if v_code is null then continue; end if;

    insert into public.pos_device_incidents (
      latest_id,snapshot_id,tenant_id,branch_id,pos_device_id,pos_session_id,
      device_code,machine_id,code,severity,title,message,metadata,
      detected_at,last_seen_at,occurrence_count
    ) values (
      p_latest_id,p_snapshot_id,p_tenant_id,p_branch_id,p_pos_device_id,p_pos_session_id,
      p_device_code,p_machine_id,v_code,
      case when v_incident->>'severity' in ('info','warning','critical')
        then v_incident->>'severity' else 'warning' end,
      coalesce(nullif(v_incident->>'title',''),v_code),
      coalesce(v_incident->>'message',''),
      coalesce(v_incident->'metadata','{}'::jsonb),
      coalesce(nullif(v_incident->>'detected_at','')::timestamptz,p_captured_at,now()),
      coalesce(p_captured_at,now()),
      1
    )
    on conflict (tenant_id,branch_id,device_code,machine_id,code)
      where resolved_at is null
    do update
    set latest_id=excluded.latest_id,
        snapshot_id=excluded.snapshot_id,
        pos_device_id=excluded.pos_device_id,
        pos_session_id=excluded.pos_session_id,
        severity=excluded.severity,
        title=excluded.title,
        message=excluded.message,
        metadata=excluded.metadata,
        last_seen_at=greatest(
          coalesce(public.pos_device_incidents.last_seen_at,public.pos_device_incidents.detected_at),
          excluded.last_seen_at
        ),
        occurrence_count=public.pos_device_incidents.occurrence_count+1;
  end loop;

  select count(*)::integer into v_active
  from public.pos_device_incidents i
  where i.tenant_id=p_tenant_id and i.branch_id=p_branch_id
    and i.device_code=p_device_code and i.machine_id=p_machine_id
    and i.resolved_at is null;

  return jsonb_build_object(
    'active_count',v_active,
    'resolved_count',v_resolved,
    'reported_codes',to_jsonb(v_codes)
  );
end;
$$;

revoke all on function public.record_pos_device_incidents(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,timestamptz
) from public,anon,authenticated;
grant execute on function public.record_pos_device_incidents(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text,jsonb,timestamptz
) to service_role;
