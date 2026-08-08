-- Printer Execution Queue hardening for CpiPOS-002 Trial data plane.
-- Print-agent identity remains in CpiPOS-001; Trial stores business print jobs and attempt history only.

alter table public.print_jobs
  add column if not exists claimed_by_agent_id uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists agent_attempt_id text,
  add column if not exists agent_error_code text;

create unique index if not exists ux_trial_print_jobs_scope_id
  on public.print_jobs(tenant_id, branch_id, id);
create index if not exists idx_trial_print_jobs_agent_claim
  on public.print_jobs(tenant_id, branch_id, status, claim_expires_at, created_at);

create table if not exists public.print_job_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  print_job_id uuid not null,
  agent_id uuid not null,
  agent_attempt_id text not null,
  attempt_no integer not null check (attempt_no > 0),
  status text not null check (status in ('claimed','printed','failed','expired')),
  lease_expires_at timestamptz,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  error_message text,
  provider_job_id text,
  bytes_sent bigint check (bytes_sent is null or bytes_sent >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, agent_attempt_id),
  unique (print_job_id, attempt_no),
  foreign key (tenant_id, branch_id, print_job_id)
    references public.print_jobs(tenant_id, branch_id, id) on delete cascade
);

create index if not exists idx_trial_print_job_attempts_job
  on public.print_job_attempts(tenant_id, branch_id, print_job_id, attempt_no desc);
create index if not exists idx_trial_print_job_attempts_agent
  on public.print_job_attempts(tenant_id, branch_id, agent_id, created_at desc);

alter table public.print_job_attempts enable row level security;
revoke all on public.print_job_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.print_job_attempts to service_role;

create or replace function app.claim_print_jobs_v2(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_agent_id uuid,
  p_printer_ids uuid[],
  p_limit integer default 5,
  p_lease_seconds integer default 45
)
returns table (job_id uuid,agent_attempt_id text,attempt_no integer,claim_expires_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_limit integer := least(10, greatest(1, coalesce(p_limit, 5)));
  v_lease_seconds integer := least(300, greatest(15, coalesce(p_lease_seconds, 45)));
  v_now timestamptz := now();
  v_expires timestamptz;
  v_job public.print_jobs%rowtype;
  v_expired public.print_jobs%rowtype;
  v_attempt_id text;
  v_attempt_no integer;
  v_next_retry integer;
begin
  if p_tenant_id is null or p_branch_id is null or p_agent_id is null then raise exception 'PRINT_SCOPE_REQUIRED'; end if;

  for v_expired in
    select pj.* from public.print_jobs pj
    where pj.tenant_id=p_tenant_id and pj.branch_id=p_branch_id and pj.status='printing'
      and pj.claim_expires_at is not null and pj.claim_expires_at <= v_now
    order by pj.claim_expires_at,pj.created_at for update skip locked
  loop
    if v_expired.agent_attempt_id is not null then
      update public.print_job_attempts a
      set status='expired',completed_at=coalesce(a.completed_at,v_now),error_code=coalesce(a.error_code,'lease_expired'),
          error_message=coalesce(a.error_message,'Print worker lease expired before ACK.'),
          metadata=coalesce(a.metadata,'{}'::jsonb)||jsonb_build_object('lease_expired_at',v_now),updated_at=v_now
      where a.tenant_id=p_tenant_id and a.branch_id=p_branch_id and a.print_job_id=v_expired.id
        and a.agent_attempt_id=v_expired.agent_attempt_id and a.status='claimed';
    end if;
    v_next_retry := coalesce(v_expired.retry_count,0)+1;
    update public.print_jobs pj
    set status=case when v_next_retry < coalesce(v_expired.max_retry_count,0) then 'retrying' else 'failed' end,
        retry_count=v_next_retry,claimed_by_agent_id=null,claimed_at=null,claim_expires_at=null,agent_attempt_id=null,
        agent_error_code='lease_expired',last_error='Print worker lease expired before ACK.',
        failed_at=case when v_next_retry < coalesce(v_expired.max_retry_count,0) then null else v_now end,updated_at=v_now
    where pj.id=v_expired.id and pj.tenant_id=p_tenant_id and pj.branch_id=p_branch_id;
  end loop;

  if coalesce(array_length(p_printer_ids,1),0)=0 then return; end if;

  for v_job in
    select pj.* from public.print_jobs pj
    join public.printer_profiles pp on pp.id=pj.printer_id and pp.tenant_id=pj.tenant_id and pp.branch_id=pj.branch_id
      and pp.enabled=true and pp.printer_role=pj.printer_role
    where pj.tenant_id=p_tenant_id and pj.branch_id=p_branch_id and pj.status in ('pending','retrying')
      and pj.retry_count < pj.max_retry_count and pp.id=any(p_printer_ids)
    order by pj.created_at,pj.id for update of pj skip locked limit v_limit
  loop
    select coalesce(max(a.attempt_no),0)+1 into v_attempt_no from public.print_job_attempts a where a.print_job_id=v_job.id;
    v_attempt_id := gen_random_uuid()::text;
    v_expires := v_now + make_interval(secs => v_lease_seconds);
    update public.print_jobs pj
    set status='printing',claimed_by_agent_id=p_agent_id,claimed_at=v_now,claim_expires_at=v_expires,
        agent_attempt_id=v_attempt_id,agent_error_code=null,failed_at=null,updated_at=v_now
    where pj.id=v_job.id and pj.tenant_id=p_tenant_id and pj.branch_id=p_branch_id;
    insert into public.print_job_attempts(tenant_id,branch_id,print_job_id,agent_id,agent_attempt_id,attempt_no,status,lease_expires_at,claimed_at,metadata)
    values(p_tenant_id,p_branch_id,v_job.id,p_agent_id,v_attempt_id,v_attempt_no,'claimed',v_expires,v_now,jsonb_build_object('source','app.claim_print_jobs_v2'));
    job_id:=v_job.id; agent_attempt_id:=v_attempt_id; attempt_no:=v_attempt_no; claim_expires_at:=v_expires; return next;
  end loop;
end;
$$;

create or replace function app.ack_print_job_v2(
  p_tenant_id uuid,p_branch_id uuid,p_job_id uuid,p_agent_id uuid,p_agent_attempt_id text,
  p_provider_job_id text default null,p_bytes_sent bigint default null,p_metadata jsonb default '{}'::jsonb
)
returns table (job_id uuid,job_status text,retry_count integer,printed_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_job public.print_jobs%rowtype; v_now timestamptz:=now();
  v_attempt text:=nullif(btrim(coalesce(p_agent_attempt_id,'')),'');
begin
  if v_attempt is null then raise exception 'PRINT_JOB_ATTEMPT_REQUIRED'; end if;
  if p_bytes_sent is not null and p_bytes_sent < 0 then raise exception 'PRINT_BYTES_INVALID'; end if;
  select * into v_job from public.print_jobs pj
  where pj.id=p_job_id and pj.tenant_id=p_tenant_id and pj.branch_id=p_branch_id for update;
  if not found then raise exception 'PRINT_JOB_NOT_FOUND'; end if;
  if v_job.status='printed' and v_job.claimed_by_agent_id=p_agent_id and v_job.agent_attempt_id=v_attempt then
    job_id:=v_job.id;job_status:=v_job.status;retry_count:=v_job.retry_count;printed_at:=v_job.printed_at;return next;return;
  end if;
  if v_job.status<>'printing' or v_job.claimed_by_agent_id is distinct from p_agent_id or v_job.agent_attempt_id is distinct from v_attempt then
    raise exception 'PRINT_JOB_ATTEMPT_STALE';
  end if;
  if v_job.claim_expires_at is null or v_job.claim_expires_at <= v_now then
    raise exception 'PRINT_JOB_ATTEMPT_STALE';
  end if;
  update public.print_job_attempts a
  set status='printed',completed_at=v_now,provider_job_id=nullif(btrim(coalesce(p_provider_job_id,'')),''),bytes_sent=p_bytes_sent,
      metadata=coalesce(a.metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb),updated_at=v_now
  where a.tenant_id=p_tenant_id and a.branch_id=p_branch_id and a.print_job_id=p_job_id and a.agent_id=p_agent_id
    and a.agent_attempt_id=v_attempt and a.status='claimed';
  if not found then raise exception 'PRINT_JOB_ATTEMPT_STALE'; end if;
  update public.print_jobs pj
  set status='printed',printed_at=v_now,failed_at=null,last_error=null,agent_error_code=null,claim_expires_at=null,
      metadata=coalesce(pj.metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb)
        ||jsonb_build_object('agent_id',p_agent_id,'agent_attempt_id',v_attempt,'provider_job_id',p_provider_job_id,'bytes_sent',p_bytes_sent),updated_at=v_now
  where pj.id=p_job_id and pj.tenant_id=p_tenant_id and pj.branch_id=p_branch_id returning * into v_job;
  job_id:=v_job.id;job_status:=v_job.status;retry_count:=v_job.retry_count;printed_at:=v_job.printed_at;return next;
end;
$$;

create or replace function app.fail_print_job_v2(
  p_tenant_id uuid,p_branch_id uuid,p_job_id uuid,p_agent_id uuid,p_agent_attempt_id text,
  p_error_message text default null,p_error_code text default null,p_retryable boolean default true,p_metadata jsonb default '{}'::jsonb
)
returns table (job_id uuid,job_status text,retry_count integer,failed_at timestamptz)
language plpgsql security definer set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_job public.print_jobs%rowtype;v_now timestamptz:=now();v_attempt text:=nullif(btrim(coalesce(p_agent_attempt_id,'')),'');
  v_next_retry integer;v_can_retry boolean;v_previous_failed boolean;
begin
  if v_attempt is null then raise exception 'PRINT_JOB_ATTEMPT_REQUIRED'; end if;
  select * into v_job from public.print_jobs pj where pj.id=p_job_id and pj.tenant_id=p_tenant_id and pj.branch_id=p_branch_id for update;
  if not found then raise exception 'PRINT_JOB_NOT_FOUND'; end if;
  if v_job.status<>'printing' or v_job.claimed_by_agent_id is distinct from p_agent_id or v_job.agent_attempt_id is distinct from v_attempt then
    select exists(select 1 from public.print_job_attempts a where a.tenant_id=p_tenant_id and a.branch_id=p_branch_id
      and a.print_job_id=p_job_id and a.agent_id=p_agent_id and a.agent_attempt_id=v_attempt and a.status='failed') into v_previous_failed;
    if v_previous_failed then job_id:=v_job.id;job_status:=v_job.status;retry_count:=v_job.retry_count;failed_at:=v_job.failed_at;return next;return;end if;
    raise exception 'PRINT_JOB_ATTEMPT_STALE';
  end if;
  if v_job.claim_expires_at is null or v_job.claim_expires_at <= v_now then
    raise exception 'PRINT_JOB_ATTEMPT_STALE';
  end if;
  update public.print_job_attempts a
  set status='failed',completed_at=v_now,error_code=nullif(btrim(coalesce(p_error_code,'')),''),
      error_message=coalesce(nullif(btrim(coalesce(p_error_message,'')),''),nullif(btrim(coalesce(p_error_code,'')),''),'agent_print_failed'),
      metadata=coalesce(a.metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb),updated_at=v_now
  where a.tenant_id=p_tenant_id and a.branch_id=p_branch_id and a.print_job_id=p_job_id and a.agent_id=p_agent_id
    and a.agent_attempt_id=v_attempt and a.status='claimed';
  if not found then raise exception 'PRINT_JOB_ATTEMPT_STALE'; end if;
  v_next_retry:=coalesce(v_job.retry_count,0)+1;
  v_can_retry:=coalesce(p_retryable,true) and v_next_retry < coalesce(v_job.max_retry_count,0);
  update public.print_jobs pj
  set status=case when v_can_retry then 'retrying' else 'failed' end,retry_count=v_next_retry,
      claimed_by_agent_id=null,claimed_at=null,claim_expires_at=null,agent_attempt_id=null,
      agent_error_code=nullif(btrim(coalesce(p_error_code,'')),''),
      last_error=coalesce(nullif(btrim(coalesce(p_error_message,'')),''),nullif(btrim(coalesce(p_error_code,'')),''),'agent_print_failed'),
      failed_at=case when v_can_retry then null else v_now end,
      metadata=coalesce(pj.metadata,'{}'::jsonb)||coalesce(p_metadata,'{}'::jsonb)
        ||jsonb_build_object('last_agent_id',p_agent_id,'last_agent_attempt_id',v_attempt),updated_at=v_now
  where pj.id=p_job_id and pj.tenant_id=p_tenant_id and pj.branch_id=p_branch_id returning * into v_job;
  job_id:=v_job.id;job_status:=v_job.status;retry_count:=v_job.retry_count;failed_at:=v_job.failed_at;return next;
end;
$$;

revoke all on function app.claim_print_jobs_v2(uuid,uuid,uuid,uuid[],integer,integer) from public,anon,authenticated;
revoke all on function app.ack_print_job_v2(uuid,uuid,uuid,uuid,text,text,bigint,jsonb) from public,anon,authenticated;
revoke all on function app.fail_print_job_v2(uuid,uuid,uuid,uuid,text,text,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function app.claim_print_jobs_v2(uuid,uuid,uuid,uuid[],integer,integer) to service_role;
grant execute on function app.ack_print_job_v2(uuid,uuid,uuid,uuid,text,text,bigint,jsonb) to service_role;
grant execute on function app.fail_print_job_v2(uuid,uuid,uuid,uuid,text,text,text,boolean,jsonb) to service_role;

create or replace function public.claim_print_jobs_v2(p_tenant_id uuid,p_branch_id uuid,p_agent_id uuid,p_printer_ids uuid[],p_limit integer default 5,p_lease_seconds integer default 45)
returns table(job_id uuid,agent_attempt_id text,attempt_no integer,claim_expires_at timestamptz)
language sql security definer set search_path=pg_catalog,public,app,extensions
as $$select * from app.claim_print_jobs_v2(p_tenant_id,p_branch_id,p_agent_id,p_printer_ids,p_limit,p_lease_seconds);$$;
create or replace function public.ack_print_job_v2(p_tenant_id uuid,p_branch_id uuid,p_job_id uuid,p_agent_id uuid,p_agent_attempt_id text,p_provider_job_id text default null,p_bytes_sent bigint default null,p_metadata jsonb default '{}'::jsonb)
returns table(job_id uuid,job_status text,retry_count integer,printed_at timestamptz)
language sql security definer set search_path=pg_catalog,public,app,extensions
as $$select * from app.ack_print_job_v2(p_tenant_id,p_branch_id,p_job_id,p_agent_id,p_agent_attempt_id,p_provider_job_id,p_bytes_sent,p_metadata);$$;
create or replace function public.fail_print_job_v2(p_tenant_id uuid,p_branch_id uuid,p_job_id uuid,p_agent_id uuid,p_agent_attempt_id text,p_error_message text default null,p_error_code text default null,p_retryable boolean default true,p_metadata jsonb default '{}'::jsonb)
returns table(job_id uuid,job_status text,retry_count integer,failed_at timestamptz)
language sql security definer set search_path=pg_catalog,public,app,extensions
as $$select * from app.fail_print_job_v2(p_tenant_id,p_branch_id,p_job_id,p_agent_id,p_agent_attempt_id,p_error_message,p_error_code,p_retryable,p_metadata);$$;
revoke all on function public.claim_print_jobs_v2(uuid,uuid,uuid,uuid[],integer,integer) from public,anon,authenticated;
revoke all on function public.ack_print_job_v2(uuid,uuid,uuid,uuid,text,text,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.fail_print_job_v2(uuid,uuid,uuid,uuid,text,text,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.claim_print_jobs_v2(uuid,uuid,uuid,uuid[],integer,integer) to service_role;
grant execute on function public.ack_print_job_v2(uuid,uuid,uuid,uuid,text,text,bigint,jsonb) to service_role;
grant execute on function public.fail_print_job_v2(uuid,uuid,uuid,uuid,text,text,text,boolean,jsonb) to service_role;

notify pgrst,'reload schema';
