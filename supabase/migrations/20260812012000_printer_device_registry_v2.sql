-- CpIPOS Printer Settings v3 device registry.
-- Additive only: printer_profiles / print_jobs remain the execution source of truth.

create table if not exists public.printer_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  printer_profile_id uuid unique references public.printer_profiles(id) on delete set null,
  display_name text not null,
  brand text,
  model text,
  connection_mode text not null check (connection_mode in ('lan','usb','bluetooth')),
  paper_width_mm integer not null check (paper_width_mm in (58,80)),
  device_fingerprint text,
  runtime_device_code text,
  status text not null default 'checking' check (status in ('online','offline','checking','connecting','needs_check','disabled','disconnected')),
  capabilities jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  disconnected_at timestamptz,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, device_fingerprint)
);

create table if not exists public.printer_device_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  printer_device_id uuid not null references public.printer_devices(id) on delete cascade,
  purpose text not null check (purpose in ('receipt','kitchen','drink','bar','reprint','shift_report','payment_slip','cash_drawer')),
  zone_key text not null default '',
  is_enabled boolean not null default true,
  is_default boolean not null default false,
  copies integer not null default 1 check (copies between 1 and 9),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (printer_device_id, purpose, zone_key)
);

create table if not exists public.printer_device_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  printer_device_id uuid references public.printer_devices(id) on delete set null,
  printer_profile_id uuid references public.printer_profiles(id) on delete set null,
  event_type text not null check (event_type in ('discovered','connected','reconnected','updated','disconnected','test_print_requested','drawer_test_requested','deleted','status_changed')),
  device_name text not null,
  brand text,
  model text,
  connection_mode text check (connection_mode in ('lan','usb','bluetooth')),
  paper_width_mm integer check (paper_width_mm in (58,80)),
  details jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_printer_devices_scope on public.printer_devices(tenant_id, branch_id, is_active, updated_at desc);
create index if not exists idx_printer_device_assignments_scope on public.printer_device_assignments(tenant_id, branch_id, purpose, is_enabled);
create index if not exists idx_printer_device_history_scope on public.printer_device_history(tenant_id, branch_id, created_at desc);

alter table public.printer_devices enable row level security;
alter table public.printer_device_assignments enable row level security;
alter table public.printer_device_history enable row level security;
revoke all on public.printer_devices, public.printer_device_assignments, public.printer_device_history from anon, authenticated;
grant all on public.printer_devices, public.printer_device_assignments, public.printer_device_history to service_role;

insert into public.printer_devices (
  tenant_id, branch_id, printer_profile_id, display_name, brand, model, connection_mode,
  paper_width_mm, device_fingerprint, runtime_device_code, status, capabilities,
  last_seen_at, is_active, metadata, created_by, created_at, updated_at
)
select
  pp.tenant_id, pp.branch_id, pp.id, pp.printer_name,
  nullif(pp.metadata->>'brand',''), nullif(pp.metadata->>'model',''),
  case
    when coalesce(pp.metadata->>'user_connection_mode', pp.metadata->>'connection_mode', pp.metadata->>'transport_mode') in ('lan','usb','bluetooth')
      then coalesce(pp.metadata->>'user_connection_mode', pp.metadata->>'connection_mode', pp.metadata->>'transport_mode')
    when pp.connection_type::text = 'NETWORK_ESC_POS' then 'lan'
    when pp.connection_type::text = 'BLUETOOTH_BRIDGE' then 'bluetooth'
    else 'usb'
  end,
  pp.paper_width_mm,
  nullif(pp.metadata->>'device_fingerprint',''),
  nullif(coalesce(pp.metadata->>'agent_device_code', pp.metadata->>'runtime_device_code', pp.metadata->>'device_code'),''),
  case when pp.enabled then coalesce(nullif(pp.metadata->>'status',''),'checking') else 'disabled' end,
  coalesce(pp.metadata->'capabilities','{}'::jsonb),
  case when coalesce(pp.metadata->>'last_runtime_heartbeat_at', pp.metadata->>'last_seen_at') ~ '^\d{4}-\d{2}-\d{2}' then coalesce(pp.metadata->>'last_runtime_heartbeat_at', pp.metadata->>'last_seen_at')::timestamptz else null end,
  pp.enabled,
  jsonb_build_object('source','printer_profiles_backfill','profile_metadata',pp.metadata),
  pp.created_by, pp.created_at, pp.updated_at
from public.printer_profiles pp
on conflict (printer_profile_id) do nothing;

insert into public.printer_device_assignments (tenant_id, branch_id, printer_device_id, purpose, zone_key, is_enabled)
select pd.tenant_id, pd.branch_id, pd.id, f.value, '', true
from public.printer_devices pd
join public.printer_profiles pp on pp.id = pd.printer_profile_id
cross join lateral jsonb_array_elements_text(
  case
    when jsonb_typeof(pp.metadata->'print_functions') = 'array' then pp.metadata->'print_functions'
    when pp.printer_role::text = 'kitchen' then '["kitchen"]'::jsonb
    when pp.printer_role::text = 'report' then '["shift_report"]'::jsonb
    else '["receipt"]'::jsonb
  end
) f(value)
where f.value in ('receipt','kitchen','drink','bar','reprint','shift_report','payment_slip','cash_drawer')
on conflict (printer_device_id, purpose, zone_key) do nothing;

notify pgrst, 'reload schema';