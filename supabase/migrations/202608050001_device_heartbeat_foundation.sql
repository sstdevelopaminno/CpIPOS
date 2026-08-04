-- Device MDM / Diagnostics heartbeat storage foundation.
-- Stores the latest cashier-device health snapshot, historical snapshots, and derived incidents.
-- This phase is write-only through server-side service-role APIs. It does not add remote-control capability.

create table if not exists public.pos_device_health_latest (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  pos_device_id uuid null,
  pos_session_id uuid null,
  device_code text not null,
  machine_id text not null,
  hostname text null,
  windows_username text null,
  runtime_version text null,
  app_version text null,
  status text not null default 'healthy' check (status in ('healthy', 'degraded', 'critical', 'offline')),
  summary jsonb not null default '{}'::jsonb,
  identity jsonb not null default '{}'::jsonb,
  connectivity jsonb not null default '{}'::jsonb,
  system_health jsonb not null default '{}'::jsonb,
  runtime_health jsonb not null default '{}'::jsonb,
  peripheral_health jsonb not null default '{}'::jsonb,
  offline_sale_health jsonb not null default '{}'::jsonb,
  security_signals jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  last_error text null,
  captured_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, device_code, machine_id)
);

create table if not exists public.pos_device_health_snapshots (
  id uuid primary key default gen_random_uuid(),
  latest_id uuid null references public.pos_device_health_latest(id) on delete set null,
  tenant_id uuid not null,
  branch_id uuid not null,
  pos_device_id uuid null,
  pos_session_id uuid null,
  device_code text not null,
  machine_id text not null,
  status text not null check (status in ('healthy', 'degraded', 'critical', 'offline')),
  summary jsonb not null default '{}'::jsonb,
  payload jsonb not null,
  incident_count integer not null default 0,
  critical_count integer not null default 0,
  warning_count integer not null default 0,
  info_count integer not null default 0,
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pos_device_incidents (
  id uuid primary key default gen_random_uuid(),
  latest_id uuid null references public.pos_device_health_latest(id) on delete set null,
  snapshot_id uuid null references public.pos_device_health_snapshots(id) on delete cascade,
  tenant_id uuid not null,
  branch_id uuid not null,
  pos_device_id uuid null,
  pos_session_id uuid null,
  device_code text not null,
  machine_id text not null,
  code text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists pos_device_health_latest_scope_idx
  on public.pos_device_health_latest (tenant_id, branch_id, status, last_seen_at desc);

create index if not exists pos_device_health_latest_device_idx
  on public.pos_device_health_latest (tenant_id, branch_id, device_code, machine_id);

create index if not exists pos_device_health_snapshots_scope_idx
  on public.pos_device_health_snapshots (tenant_id, branch_id, device_code, captured_at desc);

create index if not exists pos_device_incidents_open_idx
  on public.pos_device_incidents (tenant_id, branch_id, severity, created_at desc)
  where resolved_at is null;

create index if not exists pos_device_incidents_device_idx
  on public.pos_device_incidents (tenant_id, branch_id, device_code, machine_id, detected_at desc);

alter table public.pos_device_health_latest enable row level security;
alter table public.pos_device_health_snapshots enable row level security;
alter table public.pos_device_incidents enable row level security;

comment on table public.pos_device_health_latest is 'Latest MDM/diagnostics heartbeat per POS cashier device and machine.';
comment on table public.pos_device_health_snapshots is 'Historical MDM/diagnostics heartbeat snapshots for after-sales diagnostics.';
comment on table public.pos_device_incidents is 'Derived device incidents from MDM/diagnostics heartbeats.';
