-- MDM Phase B: remote command channel (poll-based, delivered via device heartbeat).
-- Fixed allowlist enforced in application code (apps/backoffice-web/src/lib/device-commands.ts).
-- This is NOT remote code execution: command_type is a closed enum of safe, specific actions.

create table if not exists public.device_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  pos_device_id uuid not null references public.branch_devices(id) on delete cascade,
  command_type text not null check (command_type in (
    'request_diagnostics_bundle',
    'reload_ui',
    'clear_print_queue',
    'restart_local_bridge',
    'refresh_config',
    'disable_device',
    'enable_device'
  )),
  status text not null default 'pending' check (status in ('pending', 'delivered', 'expired')),
  issued_by_user_id uuid not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  delivered_at timestamptz null,
  result jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists device_commands_pending_lookup_idx
  on public.device_commands (pos_device_id, status, expires_at)
  where status = 'pending';

create index if not exists device_commands_scope_idx
  on public.device_commands (tenant_id, branch_id, issued_at desc);

alter table public.device_commands enable row level security;

comment on table public.device_commands is 'IT Admin-issued remote commands for CpIPOS devices, delivered via the next device heartbeat poll. Fixed allowlist only, no arbitrary code execution.';
