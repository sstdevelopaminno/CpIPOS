-- Durable print-agent retry policy derived from FG0003 2026-08-21 LAN kitchen outages.
-- Do not burn all retries in a tight loop. Kitchen jobs get a longer retry horizon because
-- an order/payment must never be replayed just to recover a temporary printer/network outage.

create or replace function app.claim_print_jobs_v2(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_agent_id uuid,
  p_printer_ids uuid[],
  p_limit integer default 5,
  p_lease_seconds integer default 45
)
returns table(job_id uuid, agent_attempt_id text, attempt_no integer, claim_expires_at timestamptz)
language plpgsql
security definer
set search_path to pg_catalog, public, app, extensions
as $$
declare
  v_limit integer := least(10, greatest(1, coalesce(p_limit, 5)));
  v_lease_seconds integer := least(300, greatest(15, coalesce(p_lease_seconds, 45)));
  v_now timestamptz := now();
  v_now_epoch_ms numeric := floor(extract(epoch from v_now) * 1000);
  v_expires timestamptz;
  v_job public.print_jobs%rowtype;
  v_expired public.print_jobs%rowtype;
  v_attempt_id text;
  v_attempt_no integer;
  v_next_retry integer;
  v_effective_max_retry integer;
  v_retry_delay_seconds integer;
  v_retry_after timestamptz;
begin
  if p_tenant_id is null or p_branch_id is null or p_agent_id is null then
    raise exception 'PRINT_SCOPE_REQUIRED';
  end if;

  -- Expired leases are retryable failures too. Apply the same durable spacing as explicit
  -- agent failures so a temporarily slow/offline device is not hammered immediately.
  for v_expired in
    select pj.*
    from public.print_jobs pj
    where pj.tenant_id = p_tenant_id
      and pj.branch_id = p_branch_id
      and pj.status = 'printing'
      and pj.claim_expires_at is not null
      and pj.claim_expires_at <= v_now
    order by pj.claim_expires_at, pj.created_at
    for update skip locked
  loop
    if v_expired.agent_attempt_id is not null then
      update public.print_job_attempts a
      set
        status = 'expired',
        completed_at = coalesce(a.completed_at, v_now),
        error_code = coalesce(a.error_code, 'lease_expired'),
        error_message = coalesce(a.error_message, 'Print worker lease expired before ACK.'),
        metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object('lease_expired_at', v_now),
        updated_at = v_now
      where a.tenant_id = p_tenant_id
        and a.branch_id = p_branch_id
        and a.print_job_id = v_expired.id
        and a.agent_attempt_id = v_expired.agent_attempt_id
        and a.status = 'claimed';
    end if;

    v_next_retry := coalesce(v_expired.retry_count, 0) + 1;
    v_effective_max_retry := greatest(
      coalesce(v_expired.max_retry_count, 0),
      case when v_expired.printer_role = 'kitchen' then 7 else coalesce(v_expired.max_retry_count, 0) end
    );
    v_retry_delay_seconds := case
      when v_next_retry <= 1 then 5
      when v_next_retry = 2 then 15
      when v_next_retry = 3 then 45
      when v_next_retry = 4 then 120
      when v_next_retry = 5 then 300
      else 600
    end;
    v_retry_after := v_now + make_interval(secs => v_retry_delay_seconds);

    update public.print_jobs pj
    set
      status = case
        when v_next_retry < v_effective_max_retry then 'retrying'::public.print_job_status
        else 'failed'::public.print_job_status
      end,
      retry_count = v_next_retry,
      max_retry_count = v_effective_max_retry,
      claimed_by_agent_id = null,
      claimed_at = null,
      claim_expires_at = null,
      agent_attempt_id = null,
      agent_error_code = 'lease_expired',
      last_error = 'Print worker lease expired before ACK.',
      failed_at = case when v_next_retry < v_effective_max_retry then null else v_now end,
      metadata = coalesce(pj.metadata, '{}'::jsonb) || case
        when v_next_retry < v_effective_max_retry then jsonb_build_object(
          'retry_policy', 'durable_v1',
          'retry_backoff_seconds', v_retry_delay_seconds,
          'retry_after_epoch_ms', floor(extract(epoch from v_retry_after) * 1000)
        )
        else jsonb_build_object(
          'retry_policy', 'durable_v1',
          'retry_backoff_seconds', null,
          'retry_after_epoch_ms', null
        )
      end,
      updated_at = v_now
    where pj.id = v_expired.id
      and pj.tenant_id = p_tenant_id
      and pj.branch_id = p_branch_id;
  end loop;

  if coalesce(array_length(p_printer_ids, 1), 0) = 0 then
    return;
  end if;

  for v_job in
    select pj.*
    from public.print_jobs pj
    join public.printer_profiles pp
      on pp.id = pj.printer_id
     and pp.tenant_id = pj.tenant_id
     and pp.branch_id = pj.branch_id
     and pp.enabled = true
    where pj.tenant_id = p_tenant_id
      and pj.branch_id = p_branch_id
      and pj.status in ('pending', 'retrying')
      and pj.retry_count < pj.max_retry_count
      and (
        pj.status = 'pending'
        or coalesce(jsonb_typeof(pj.metadata->'retry_after_epoch_ms'), 'null') <> 'number'
        or (pj.metadata->>'retry_after_epoch_ms')::numeric <= v_now_epoch_ms
      )
      and pp.id = any(p_printer_ids)
      and (
        pp.printer_role = pj.printer_role
        or (
          pj.printer_role = 'kitchen'
          and coalesce(pj.metadata->>'routing_source', '') = 'assignment'
          and coalesce(pj.metadata->>'routing_purpose', '') = 'kitchen'
          and nullif(btrim(coalesce(pj.metadata->>'routing_printer_device_id', '')), '') is not null
          and exists (
            select 1
            from public.printer_device_assignments pda
            join public.printer_devices pd
              on pd.id = pda.printer_device_id
             and pd.tenant_id = pda.tenant_id
             and pd.branch_id = pda.branch_id
            where pda.tenant_id = pj.tenant_id
              and pda.branch_id = pj.branch_id
              and pda.is_enabled = true
              and pda.purpose::text = 'kitchen'
              and pda.printer_device_id::text = pj.metadata->>'routing_printer_device_id'
              and pd.is_active = true
              and pd.printer_profile_id = pp.id
              and coalesce(pd.capabilities->>'kitchen', 'false') = 'true'
              and (
                nullif(btrim(coalesce(pda.zone_key, '')), '') is null
                or nullif(btrim(coalesce(pda.zone_key, '')), '') = nullif(btrim(coalesce(pj.metadata->>'routing_zone_key', '')), '')
              )
          )
        )
      )
    order by
      case when coalesce(pj.metadata->>'command', '') = 'open_cash_drawer' then 0 else 1 end,
      pj.created_at,
      pj.id
    for update of pj skip locked
    limit v_limit
  loop
    select coalesce(max(a.attempt_no), 0) + 1
      into v_attempt_no
    from public.print_job_attempts a
    where a.print_job_id = v_job.id;

    v_attempt_id := gen_random_uuid()::text;
    v_expires := v_now + make_interval(secs => v_lease_seconds);

    update public.print_jobs pj
    set
      status = 'printing',
      claimed_by_agent_id = p_agent_id,
      claimed_at = v_now,
      claim_expires_at = v_expires,
      agent_attempt_id = v_attempt_id,
      agent_error_code = null,
      failed_at = null,
      updated_at = v_now
    where pj.id = v_job.id
      and pj.tenant_id = p_tenant_id
      and pj.branch_id = p_branch_id;

    insert into public.print_job_attempts(
      tenant_id,
      branch_id,
      print_job_id,
      agent_id,
      agent_attempt_id,
      attempt_no,
      status,
      lease_expires_at,
      claimed_at,
      metadata
    ) values (
      p_tenant_id,
      p_branch_id,
      v_job.id,
      p_agent_id,
      v_attempt_id,
      v_attempt_no,
      'claimed',
      v_expires,
      v_now,
      jsonb_build_object('source', 'app.claim_print_jobs_v2')
    );

    job_id := v_job.id;
    agent_attempt_id := v_attempt_id;
    attempt_no := v_attempt_no;
    claim_expires_at := v_expires;
    return next;
  end loop;
end;
$$;

create or replace function app.fail_print_job_v2(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_job_id uuid,
  p_agent_id uuid,
  p_agent_attempt_id text,
  p_error_message text default null,
  p_error_code text default null,
  p_retryable boolean default true,
  p_metadata jsonb default '{}'::jsonb
)
returns table(job_id uuid, job_status text, retry_count integer, failed_at timestamptz)
language plpgsql
security definer
set search_path to pg_catalog, public, app, extensions
as $$
declare
  v_job public.print_jobs%rowtype;
  v_now timestamptz := now();
  v_attempt text := nullif(btrim(coalesce(p_agent_attempt_id, '')), '');
  v_next_retry integer;
  v_effective_max_retry integer;
  v_can_retry boolean;
  v_previous_failed boolean;
  v_retry_delay_seconds integer;
  v_retry_after timestamptz;
begin
  if v_attempt is null then raise exception 'PRINT_JOB_ATTEMPT_REQUIRED'; end if;

  select * into v_job
  from public.print_jobs pj
  where pj.id = p_job_id
    and pj.tenant_id = p_tenant_id
    and pj.branch_id = p_branch_id
  for update;
  if not found then raise exception 'PRINT_JOB_NOT_FOUND'; end if;

  if v_job.status <> 'printing'
     or v_job.claimed_by_agent_id is distinct from p_agent_id
     or v_job.agent_attempt_id is distinct from v_attempt then
    select exists(
      select 1
      from public.print_job_attempts a
      where a.tenant_id = p_tenant_id
        and a.branch_id = p_branch_id
        and a.print_job_id = p_job_id
        and a.agent_id = p_agent_id
        and a.agent_attempt_id = v_attempt
        and a.status = 'failed'
    ) into v_previous_failed;
    if v_previous_failed then
      job_id := v_job.id;
      job_status := v_job.status::text;
      retry_count := v_job.retry_count;
      failed_at := v_job.failed_at;
      return next;
      return;
    end if;
    raise exception 'PRINT_JOB_ATTEMPT_STALE';
  end if;

  if v_job.claim_expires_at is null or v_job.claim_expires_at <= v_now then
    raise exception 'PRINT_JOB_ATTEMPT_STALE';
  end if;

  update public.print_job_attempts a
  set
    status = 'failed',
    completed_at = v_now,
    error_code = nullif(btrim(coalesce(p_error_code, '')), ''),
    error_message = coalesce(
      nullif(btrim(coalesce(p_error_message, '')), ''),
      nullif(btrim(coalesce(p_error_code, '')), ''),
      'agent_print_failed'
    ),
    metadata = coalesce(a.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
    updated_at = v_now
  where a.tenant_id = p_tenant_id
    and a.branch_id = p_branch_id
    and a.print_job_id = p_job_id
    and a.agent_id = p_agent_id
    and a.agent_attempt_id = v_attempt
    and a.status = 'claimed';
  if not found then raise exception 'PRINT_JOB_ATTEMPT_STALE'; end if;

  v_next_retry := coalesce(v_job.retry_count, 0) + 1;
  v_effective_max_retry := greatest(
    coalesce(v_job.max_retry_count, 0),
    case when v_job.printer_role = 'kitchen' then 7 else coalesce(v_job.max_retry_count, 0) end
  );
  v_can_retry := coalesce(p_retryable, true) and v_next_retry < v_effective_max_retry;
  v_retry_delay_seconds := case
    when v_next_retry <= 1 then 5
    when v_next_retry = 2 then 15
    when v_next_retry = 3 then 45
    when v_next_retry = 4 then 120
    when v_next_retry = 5 then 300
    else 600
  end;
  v_retry_after := v_now + make_interval(secs => v_retry_delay_seconds);

  update public.print_jobs pj
  set
    status = case when v_can_retry then 'retrying'::public.print_job_status else 'failed'::public.print_job_status end,
    retry_count = v_next_retry,
    max_retry_count = v_effective_max_retry,
    claimed_by_agent_id = null,
    claimed_at = null,
    claim_expires_at = null,
    agent_attempt_id = null,
    agent_error_code = nullif(btrim(coalesce(p_error_code, '')), ''),
    last_error = coalesce(
      nullif(btrim(coalesce(p_error_message, '')), ''),
      nullif(btrim(coalesce(p_error_code, '')), ''),
      'agent_print_failed'
    ),
    failed_at = case when v_can_retry then null else v_now end,
    metadata = coalesce(pj.metadata, '{}'::jsonb)
      || coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object('last_agent_id', p_agent_id, 'last_agent_attempt_id', v_attempt)
      || case
        when v_can_retry then jsonb_build_object(
          'retry_policy', 'durable_v1',
          'retry_backoff_seconds', v_retry_delay_seconds,
          'retry_after_epoch_ms', floor(extract(epoch from v_retry_after) * 1000)
        )
        else jsonb_build_object(
          'retry_policy', 'durable_v1',
          'retry_backoff_seconds', null,
          'retry_after_epoch_ms', null
        )
      end,
    updated_at = v_now
  where pj.id = p_job_id
    and pj.tenant_id = p_tenant_id
    and pj.branch_id = p_branch_id
  returning * into v_job;

  job_id := v_job.id;
  job_status := v_job.status::text;
  retry_count := v_job.retry_count;
  failed_at := v_job.failed_at;
  return next;
end;
$$;
