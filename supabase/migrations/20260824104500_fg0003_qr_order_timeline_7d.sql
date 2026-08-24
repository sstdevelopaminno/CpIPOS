-- FG0003 QR order audit timeline (7-day rolling retention).
-- Additive/server-side only. Other tenants are not recorded by the RPC/triggers.

create table if not exists public.table_qr_client_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  table_id uuid not null,
  table_session_id uuid not null,
  qr_session_id uuid null,
  client_id text not null,
  device_brand text null,
  device_model text null,
  device_class text null,
  os_name text null,
  os_version text null,
  browser_name text null,
  browser_version text null,
  user_agent text null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  scan_count integer not null default 0,
  submit_attempt_count integer not null default 0,
  submit_success_count integer not null default 0,
  submit_failure_count integer not null default 0,
  duplicate_count integer not null default 0,
  last_request_id text null,
  metadata jsonb not null default '{}'::jsonb,
  constraint table_qr_client_sessions_client_id_len check (char_length(client_id) between 1 and 120),
  constraint table_qr_client_sessions_scope_client_key unique (tenant_id, branch_id, table_session_id, client_id)
);

create table if not exists public.table_qr_timeline_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  table_id uuid not null,
  table_session_id uuid not null,
  qr_session_id uuid null,
  client_session_id uuid null,
  client_id text null,
  event_type text not null,
  severity text not null default 'green',
  request_id text null,
  submission_id text null,
  order_id uuid null,
  item_count integer null,
  amount numeric(14,2) null,
  success boolean null,
  status_code integer null,
  error_code text null,
  duration_ms numeric(12,2) null,
  device_brand text null,
  device_model text null,
  device_class text null,
  os_name text null,
  os_version text null,
  browser_name text null,
  browser_version text null,
  device_summary text null,
  payload jsonb not null default '{}'::jsonb,
  event_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint table_qr_timeline_events_severity_check check (severity in ('green','yellow','red'))
);

create index if not exists idx_table_qr_client_sessions_scope_seen
  on public.table_qr_client_sessions (tenant_id, branch_id, last_seen_at desc);
create index if not exists idx_table_qr_client_sessions_table_session
  on public.table_qr_client_sessions (tenant_id, branch_id, table_session_id, last_seen_at desc);
create index if not exists idx_table_qr_timeline_scope_time
  on public.table_qr_timeline_events (tenant_id, branch_id, event_at desc);
create index if not exists idx_table_qr_timeline_table_session_time
  on public.table_qr_timeline_events (tenant_id, branch_id, table_session_id, event_at desc);
create index if not exists idx_table_qr_timeline_request
  on public.table_qr_timeline_events (tenant_id, branch_id, request_id)
  where request_id is not null;
create index if not exists idx_table_qr_timeline_event_type_time
  on public.table_qr_timeline_events (tenant_id, branch_id, event_type, event_at desc);

alter table public.table_qr_client_sessions enable row level security;
alter table public.table_qr_timeline_events enable row level security;
revoke all on public.table_qr_client_sessions from anon, authenticated;
revoke all on public.table_qr_timeline_events from anon, authenticated;
grant select, insert, update, delete on public.table_qr_client_sessions to service_role;
grant select, insert, update, delete on public.table_qr_timeline_events to service_role;

create or replace function public.record_table_qr_timeline_event(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_table_id uuid,
  p_table_session_id uuid,
  p_qr_session_id uuid default null,
  p_client_id text default null,
  p_event_type text default 'unknown',
  p_severity text default 'green',
  p_request_id text default null,
  p_submission_id text default null,
  p_order_id uuid default null,
  p_item_count integer default null,
  p_amount numeric default null,
  p_success boolean default null,
  p_status_code integer default null,
  p_error_code text default null,
  p_duration_ms numeric default null,
  p_device_brand text default null,
  p_device_model text default null,
  p_device_class text default null,
  p_os_name text default null,
  p_os_version text default null,
  p_browser_name text default null,
  p_browser_version text default null,
  p_user_agent text default null,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_id text := nullif(left(trim(coalesce(p_client_id, '')), 120), '');
  v_client_session_id uuid;
  v_event_id uuid := gen_random_uuid();
  v_device_summary text;
begin
  if not exists (
    select 1
    from public.tenants t
    join public.branches b on b.tenant_id = t.id
    where t.id = p_tenant_id
      and b.id = p_branch_id
      and t.code = 'FG0003'
  ) then
    return null;
  end if;

  if p_severity not in ('green','yellow','red') then
    p_severity := 'yellow';
  end if;

  v_device_summary := nullif(trim(concat_ws(' · ',
    nullif(trim(coalesce(p_device_brand, '')), ''),
    nullif(trim(coalesce(p_device_model, '')), ''),
    nullif(trim(concat_ws(' ', nullif(trim(coalesce(p_os_name, '')), ''), nullif(trim(coalesce(p_os_version, '')), ''))), ''),
    nullif(trim(concat_ws(' ', nullif(trim(coalesce(p_browser_name, '')), ''), nullif(trim(coalesce(p_browser_version, '')), ''))), '')
  )), '');

  if v_client_id is not null and lower(v_client_id) <> 'anonymous' then
    insert into public.table_qr_client_sessions (
      tenant_id, branch_id, table_id, table_session_id, qr_session_id, client_id,
      device_brand, device_model, device_class, os_name, os_version,
      browser_name, browser_version, user_agent,
      scan_count, submit_attempt_count, submit_success_count, submit_failure_count, duplicate_count,
      last_request_id, metadata
    ) values (
      p_tenant_id, p_branch_id, p_table_id, p_table_session_id, p_qr_session_id, v_client_id,
      nullif(left(p_device_brand, 120), ''), nullif(left(p_device_model, 160), ''), nullif(left(p_device_class, 40), ''),
      nullif(left(p_os_name, 80), ''), nullif(left(p_os_version, 80), ''),
      nullif(left(p_browser_name, 80), ''), nullif(left(p_browser_version, 80), ''), left(p_user_agent, 600),
      case when p_event_type = 'qr_opened' then 1 else 0 end,
      case when p_event_type = 'submit_attempt' then 1 else 0 end,
      case when p_event_type = 'submit_success' then 1 else 0 end,
      case when p_event_type = 'submit_failure' then 1 else 0 end,
      case when p_event_type = 'duplicate_blocked' then 1 else 0 end,
      nullif(left(p_request_id, 160), ''), '{}'::jsonb
    )
    on conflict (tenant_id, branch_id, table_session_id, client_id)
    do update set
      qr_session_id = coalesce(excluded.qr_session_id, table_qr_client_sessions.qr_session_id),
      table_id = excluded.table_id,
      last_seen_at = now(),
      device_brand = coalesce(excluded.device_brand, table_qr_client_sessions.device_brand),
      device_model = coalesce(excluded.device_model, table_qr_client_sessions.device_model),
      device_class = coalesce(excluded.device_class, table_qr_client_sessions.device_class),
      os_name = coalesce(excluded.os_name, table_qr_client_sessions.os_name),
      os_version = coalesce(excluded.os_version, table_qr_client_sessions.os_version),
      browser_name = coalesce(excluded.browser_name, table_qr_client_sessions.browser_name),
      browser_version = coalesce(excluded.browser_version, table_qr_client_sessions.browser_version),
      user_agent = coalesce(excluded.user_agent, table_qr_client_sessions.user_agent),
      scan_count = table_qr_client_sessions.scan_count + excluded.scan_count,
      submit_attempt_count = table_qr_client_sessions.submit_attempt_count + excluded.submit_attempt_count,
      submit_success_count = table_qr_client_sessions.submit_success_count + excluded.submit_success_count,
      submit_failure_count = table_qr_client_sessions.submit_failure_count + excluded.submit_failure_count,
      duplicate_count = table_qr_client_sessions.duplicate_count + excluded.duplicate_count,
      last_request_id = coalesce(excluded.last_request_id, table_qr_client_sessions.last_request_id)
    returning id into v_client_session_id;
  end if;

  insert into public.table_qr_timeline_events (
    id, tenant_id, branch_id, table_id, table_session_id, qr_session_id,
    client_session_id, client_id, event_type, severity, request_id, submission_id,
    order_id, item_count, amount, success, status_code, error_code, duration_ms,
    device_brand, device_model, device_class, os_name, os_version,
    browser_name, browser_version, device_summary, payload
  ) values (
    v_event_id, p_tenant_id, p_branch_id, p_table_id, p_table_session_id, p_qr_session_id,
    v_client_session_id, v_client_id, left(coalesce(nullif(trim(p_event_type), ''), 'unknown'), 80), p_severity,
    nullif(left(p_request_id, 160), ''), nullif(left(p_submission_id, 160), ''),
    p_order_id, p_item_count, p_amount, p_success, p_status_code, nullif(left(p_error_code, 160), ''), p_duration_ms,
    nullif(left(p_device_brand, 120), ''), nullif(left(p_device_model, 160), ''), nullif(left(p_device_class, 40), ''),
    nullif(left(p_os_name, 80), ''), nullif(left(p_os_version, 80), ''),
    nullif(left(p_browser_name, 80), ''), nullif(left(p_browser_version, 80), ''), left(v_device_summary, 500),
    coalesce(p_payload, '{}'::jsonb)
  );

  return v_event_id;
end;
$$;

revoke all on function public.record_table_qr_timeline_event(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,integer,numeric,boolean,integer,text,numeric,text,text,text,text,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.record_table_qr_timeline_event(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,integer,numeric,boolean,integer,text,numeric,text,text,text,text,text,text,text,text,jsonb) to service_role;

create or replace function public.capture_fg0003_qr_review_timeline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_type text;
  v_severity text := 'green';
  v_client_id text;
begin
  if new.event_type <> 'order' or new.review_status is not distinct from old.review_status then
    return new;
  end if;
  if not exists (select 1 from public.tenants where id = new.tenant_id and code = 'FG0003') then
    return new;
  end if;

  v_event_type := case new.review_status
    when 'accepted' then 'review_accepted'
    when 'partially_accepted' then 'review_partially_accepted'
    when 'rejected' then 'review_rejected'
    when 'kitchen_confirming' then 'review_kitchen_confirming'
    else 'review_status_changed'
  end;
  if new.review_status in ('partially_accepted','rejected','kitchen_confirming') then v_severity := 'yellow'; end if;
  v_client_id := nullif(new.payload->>'client_id', '');

  insert into public.table_qr_timeline_events (
    tenant_id, branch_id, table_id, table_session_id, qr_session_id, client_id,
    event_type, severity, request_id, submission_id, order_id, item_count, amount,
    success, payload
  ) values (
    new.tenant_id, new.branch_id, new.table_id, new.table_session_id, new.qr_session_id, v_client_id,
    v_event_type, v_severity, new.request_id, new.id::text, new.order_id, new.item_count, new.subtotal,
    case when new.review_status in ('accepted','partially_accepted') then true when new.review_status = 'rejected' then false else null end,
    jsonb_build_object(
      'review_status', new.review_status,
      'reviewed_by', new.reviewed_by,
      'reviewed_at', new.reviewed_at,
      'source', new.payload->>'source',
      'lifecycle', new.payload->>'lifecycle'
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_capture_fg0003_qr_review_timeline on public.table_qr_orders;
create trigger trg_capture_fg0003_qr_review_timeline
after update of review_status on public.table_qr_orders
for each row execute function public.capture_fg0003_qr_review_timeline();

create or replace function public.capture_fg0003_bill_timeline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_type text;
  v_severity text := 'green';
begin
  if not exists (select 1 from public.tenants where id = new.tenant_id and code = 'FG0003') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_event_type := 'bill_opened';
  elsif new.status is distinct from old.status then
    if lower(coalesce(new.status,'')) in ('paid','closed','cleared','cancelled') then
      v_event_type := 'bill_closed';
      if lower(coalesce(new.status,'')) = 'cancelled' then v_severity := 'yellow'; end if;
    else
      v_event_type := 'bill_status_changed';
      if lower(coalesce(new.status,'')) = 'pending_payment' then v_severity := 'yellow'; end if;
    end if;
  else
    return new;
  end if;

  insert into public.table_qr_timeline_events (
    tenant_id, branch_id, table_id, table_session_id, event_type, severity, order_id, success, payload, event_at
  ) values (
    new.tenant_id, new.branch_id, new.table_id, new.id, v_event_type, v_severity, new.order_id, true,
    jsonb_build_object(
      'old_status', case when tg_op = 'UPDATE' then old.status else null end,
      'new_status', new.status,
      'opened_at', new.opened_at,
      'closed_at', new.closed_at
    ),
    coalesce(case when v_event_type = 'bill_opened' then new.opened_at else new.closed_at end, now())
  );
  return new;
end;
$$;

drop trigger if exists trg_capture_fg0003_bill_timeline on public.table_bill_sessions;
create trigger trg_capture_fg0003_bill_timeline
after insert or update of status on public.table_bill_sessions
for each row execute function public.capture_fg0003_bill_timeline();

create or replace function public.capture_fg0003_item_cancel_timeline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_cancel integer := 0;
  v_new_cancel integer := 0;
  v_old_state text := lower(coalesce(old.metadata->>'bill_line_state',''));
  v_new_state text := lower(coalesce(new.metadata->>'bill_line_state',''));
  v_table_id uuid;
  v_table_session_id uuid;
begin
  if not exists (select 1 from public.tenants where id = new.tenant_id and code = 'FG0003') then
    return new;
  end if;
  if coalesce(old.metadata->>'cancelled_quantity','') ~ '^\d+$' then v_old_cancel := (old.metadata->>'cancelled_quantity')::integer; end if;
  if coalesce(new.metadata->>'cancelled_quantity','') ~ '^\d+$' then v_new_cancel := (new.metadata->>'cancelled_quantity')::integer; end if;
  if not (v_new_state = 'cancelled' and v_old_state <> 'cancelled') and v_new_cancel <= v_old_cancel then
    return new;
  end if;

  select s.table_id, s.id into v_table_id, v_table_session_id
  from public.table_bill_sessions s
  where s.tenant_id = new.tenant_id and s.branch_id = new.branch_id and s.order_id = new.order_id
  order by s.opened_at desc
  limit 1;
  if v_table_id is null or v_table_session_id is null then return new; end if;

  insert into public.table_qr_timeline_events (
    tenant_id, branch_id, table_id, table_session_id, order_id,
    event_type, severity, item_count, success, payload
  ) values (
    new.tenant_id, new.branch_id, v_table_id, v_table_session_id, new.order_id,
    'item_cancelled', 'yellow', greatest(1, v_new_cancel - v_old_cancel), true,
    jsonb_build_object(
      'order_item_id', new.id,
      'product_id', new.product_id,
      'old_quantity', old.quantity,
      'new_quantity', new.quantity,
      'old_cancelled_quantity', v_old_cancel,
      'new_cancelled_quantity', v_new_cancel,
      'bill_line_state', v_new_state
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_capture_fg0003_item_cancel_timeline on public.order_items;
create trigger trg_capture_fg0003_item_cancel_timeline
after update of quantity, metadata on public.order_items
for each row execute function public.capture_fg0003_item_cancel_timeline();

create or replace function public.cleanup_table_qr_timeline_7d()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted_events integer := 0;
begin
  delete from public.table_qr_timeline_events where event_at < now() - interval '7 days';
  get diagnostics v_deleted_events = row_count;
  delete from public.table_qr_client_sessions where last_seen_at < now() - interval '7 days';
  return v_deleted_events;
end;
$$;

revoke all on function public.cleanup_table_qr_timeline_7d() from public, anon, authenticated;
grant execute on function public.cleanup_table_qr_timeline_7d() to service_role;

-- Replace the retention job deterministically if a previous version exists.
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'fg0003_qr_timeline_retention_7d' limit 1;
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
exception when undefined_table then null;
end $$;

select cron.schedule(
  'fg0003_qr_timeline_retention_7d',
  '17 * * * *',
  $cron$select public.cleanup_table_qr_timeline_7d();$cron$
);
