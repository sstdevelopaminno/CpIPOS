-- IT Backoffice v1 tenant summary foundation.
-- Keeps broad tenant/branch/session/device/shift aggregation inside Postgres
-- so the API does not fan out across many tenants in application memory.

create or replace view public.it_admin_tenant_summary_v
with (security_invoker = true)
as
select
  t.id,
  t.code,
  t.name,
  t.owner_name,
  t.owner_phone,
  t.package_id,
  sp.code as package_code,
  sp.name as package_name,
  t.is_active,
  t.created_at,
  t.updated_at,
  latest_contract.id as contract_id,
  latest_contract.status as contract_status,
  latest_contract.started_at as contract_started_at,
  latest_contract.ended_at as contract_ended_at,
  coalesce(branch_counts.branch_count, 0)::integer as branch_count,
  coalesce(branch_counts.active_branch_count, 0)::integer as active_branch_count,
  coalesce(device_counts.device_count, 0)::integer as device_count,
  coalesce(device_counts.active_device_count, 0)::integer as active_device_count,
  coalesce(session_counts.active_session_count, 0)::integer as active_session_count,
  coalesce(shift_counts.open_shift_count, 0)::integer as open_shift_count
from public.tenants t
left join public.subscription_packages sp on sp.id = t.package_id
left join lateral (
  select c.id, c.status, c.started_at, c.ended_at
  from public.tenant_subscription_contracts c
  where c.tenant_id = t.id
  order by c.created_at desc, c.id desc
  limit 1
) latest_contract on true
left join lateral (
  select
    count(*) as branch_count,
    count(*) filter (where b.is_active) as active_branch_count
  from public.branches b
  where b.tenant_id = t.id
) branch_counts on true
left join lateral (
  select
    count(*) as device_count,
    count(*) filter (where d.status = 'active') as active_device_count
  from public.branch_devices d
  where d.tenant_id = t.id
) device_counts on true
left join lateral (
  select count(*) as active_session_count
  from public.pos_sessions ps
  where ps.tenant_id = t.id
    and ps.status = 'active'
    and ps.expires_at > now()
) session_counts on true
left join lateral (
  select count(*) as open_shift_count
  from public.shifts s
  where s.tenant_id = t.id
    and s.status = 'open'
) shift_counts on true;

revoke all on public.it_admin_tenant_summary_v from public;
revoke all on public.it_admin_tenant_summary_v from anon;
revoke all on public.it_admin_tenant_summary_v from authenticated;
grant select on public.it_admin_tenant_summary_v to service_role;

create or replace function public.get_it_admin_tenant_summary(
  p_limit integer default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_search text default null,
  p_status text default 'all',
  p_package_code text default null
)
returns table (
  id uuid,
  code text,
  name text,
  owner_name text,
  owner_phone text,
  package_id uuid,
  package_code text,
  package_name text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  contract_id uuid,
  contract_status text,
  contract_started_at timestamptz,
  contract_ended_at timestamptz,
  branch_count integer,
  active_branch_count integer,
  device_count integer,
  active_device_count integer,
  active_session_count integer,
  open_shift_count integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id,
    s.code,
    s.name,
    s.owner_name,
    s.owner_phone,
    s.package_id,
    s.package_code,
    s.package_name,
    s.is_active,
    s.created_at,
    s.updated_at,
    s.contract_id,
    s.contract_status,
    s.contract_started_at,
    s.contract_ended_at,
    s.branch_count,
    s.active_branch_count,
    s.device_count,
    s.active_device_count,
    s.active_session_count,
    s.open_shift_count
  from public.it_admin_tenant_summary_v s
  where
    (
      coalesce(nullif(trim(p_search), ''), '') = ''
      or s.code ilike '%' || trim(p_search) || '%'
      or s.name ilike '%' || trim(p_search) || '%'
      or coalesce(s.owner_name, '') ilike '%' || trim(p_search) || '%'
      or coalesce(s.owner_phone, '') ilike '%' || trim(p_search) || '%'
    )
    and (
      coalesce(nullif(trim(p_package_code), ''), '') = ''
      or s.package_code = trim(p_package_code)
    )
    and (
      coalesce(nullif(trim(p_status), ''), 'all') = 'all'
      or (p_status = 'active' and s.is_active = true)
      or (p_status = 'inactive' and s.is_active = false)
      or (p_status = 'suspended' and s.contract_status = 'suspended')
    )
    and (
      p_cursor_created_at is null
      or p_cursor_id is null
      or (s.created_at, s.id) < (p_cursor_created_at, p_cursor_id)
    )
  order by s.created_at desc, s.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 101);
$$;

revoke all on function public.get_it_admin_tenant_summary(integer, timestamptz, uuid, text, text, text) from public;
revoke all on function public.get_it_admin_tenant_summary(integer, timestamptz, uuid, text, text, text) from anon;
revoke all on function public.get_it_admin_tenant_summary(integer, timestamptz, uuid, text, text, text) from authenticated;
grant execute on function public.get_it_admin_tenant_summary(integer, timestamptz, uuid, text, text, text) to service_role;

create index if not exists idx_branches_tenant_active on public.branches(tenant_id, is_active);
create index if not exists idx_branch_devices_tenant_status on public.branch_devices(tenant_id, status);
create index if not exists idx_pos_sessions_tenant_status_expires on public.pos_sessions(tenant_id, status, expires_at desc);
create index if not exists idx_shifts_tenant_status on public.shifts(tenant_id, status);
