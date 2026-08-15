-- Production-safe Kitchen print compatibility hotfix.
-- Scope: Kitchen print jobs only. Existing exact printer-role claim behavior is unchanged.
-- Preserve history; stale terminal-order Kitchen jobs are quarantined instead of replayed.

update public.print_jobs pj
set
  status = 'failed'::public.print_job_status,
  last_error = 'stale_terminal_order_quarantine_v1',
  agent_error_code = 'stale_terminal_order',
  failed_at = now(),
  claimed_by_agent_id = null,
  claimed_at = null,
  claim_expires_at = null,
  agent_attempt_id = null,
  metadata = coalesce(pj.metadata, '{}'::jsonb) || jsonb_build_object(
    'quarantined_at', now(),
    'quarantine_reason', 'terminal_order_pending_over_10m_before_assignment_claim_compat',
    'pre_hotfix_status', pj.status::text,
    'quarantine_replay_allowed', false
  ),
  updated_at = now()
from public.orders o
where pj.order_id = o.id
  and pj.tenant_id = o.tenant_id
  and pj.branch_id = o.branch_id
  and pj.printer_role = 'kitchen'
  and pj.status in ('pending'::public.print_job_status, 'retrying'::public.print_job_status)
  and o.status::text in ('completed', 'cancelled')
  and pj.created_at < now() - interval '10 minutes';

create or replace function app.claim_print_jobs_v2(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_agent_id uuid,
  p_printer_ids uuid[],
  p_limit integer default 5,
  p_lease_seconds integer default 45
)
returns table(
  job_id uuid,
  agent_attempt_id text,
  attempt_no integer,
  claim_expires_at timestamptz
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'app', 'extensions'
as $function$
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
  if p_tenant_id is null or p_branch_id is null or p_agent_id is null then
    raise exception 'PRINT_SCOPE_REQUIRED';
  end if;

  -- Preserve the existing expired-lease recovery behavior exactly.
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
    update public.print_jobs pj
    set
      status = case
        when v_next_retry < coalesce(v_expired.max_retry_count, 0)
          then 'retrying'::public.print_job_status
        else 'failed'::public.print_job_status
      end,
      retry_count = v_next_retry,
      claimed_by_agent_id = null,
      claimed_at = null,
      claim_expires_at = null,
      agent_attempt_id = null,
      agent_error_code = 'lease_expired',
      last_error = 'Print worker lease expired before ACK.',
      failed_at = case
        when v_next_retry < coalesce(v_expired.max_retry_count, 0) then null
        else v_now
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
      and pp.id = any(p_printer_ids)
      and (
        -- Existing behavior: exact profile/job role match.
        pp.printer_role = pj.printer_role
        or
        -- Narrow compatibility path: Kitchen job routed by printer_settings_v3 assignment
        -- to a device that is active, mapped to this same profile, Kitchen-capable,
        -- and has an enabled Kitchen assignment. Receipt/report jobs are not widened.
        (
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
    order by pj.created_at, pj.id
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
$function$;
