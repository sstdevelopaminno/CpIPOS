-- MDM hardening for CpIPOS Android 1.0.23 + Web Production only.
-- This migration defines data contracts and audit tables. It does not execute any live device lock,
-- uninstall, location, or remote-screen command.

create extension if not exists pgcrypto;

create or replace function public.mdm_android_1023_web_production_eligible(
  p_platform text,
  p_app_version text,
  p_app_flavor text,
  p_native_generation text,
  p_ownership_type text,
  p_enrollment_mode text,
  p_is_device_owner boolean,
  p_capabilities jsonb
) returns boolean
language sql
stable
as $$
  select lower(coalesce(p_platform, '')) = 'android'
    and coalesce(p_app_version, '') = '1.0.23'
    and lower(coalesce(p_app_flavor, '')) in ('web-production', 'web_production', 'production_web')
    and coalesce(p_native_generation, '') <> '2.0'
    and lower(coalesce(p_ownership_type, '')) in ('company_owned', 'company_financed')
    and lower(coalesce(p_enrollment_mode, '')) in ('android_enterprise_device_owner', 'fully_managed', 'dedicated_device')
    and coalesce(p_is_device_owner, false) = true
    and coalesce(p_capabilities, '[]'::jsonb) ? 'mdm_core';
$$;

create table if not exists public.mdm_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  device_id text not null,
  serial_number text,
  display_name text,
  platform text not null default 'unknown',
  app_version text not null,
  app_flavor text not null default 'unknown',
  native_generation text,
  ownership_type text not null default 'unknown',
  enrollment_mode text not null default 'unknown',
  is_device_owner boolean not null default false,
  is_full_mdm_eligible boolean not null default false,
  capabilities jsonb not null default '[]'::jsonb,
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mdm_devices_unique_device unique (tenant_id, device_id),
  constraint mdm_devices_platform_check check (platform in ('android', 'web', 'ios', 'windows', 'unknown')),
  constraint mdm_devices_ownership_type_check check (ownership_type in ('company_owned', 'company_financed', 'customer_owned', 'byod', 'unknown')),
  constraint mdm_devices_enrollment_mode_check check (enrollment_mode in ('android_enterprise_device_owner', 'fully_managed', 'dedicated_device', 'work_profile', 'none', 'unknown')),
  constraint mdm_devices_capabilities_array_check check (jsonb_typeof(capabilities) = 'array')
);

create or replace function public.mdm_devices_set_eligibility()
returns trigger
language plpgsql
as $$
begin
  new.is_full_mdm_eligible := public.mdm_android_1023_web_production_eligible(
    new.platform,
    new.app_version,
    new.app_flavor,
    new.native_generation,
    new.ownership_type,
    new.enrollment_mode,
    new.is_device_owner,
    new.capabilities
  );
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_mdm_devices_set_eligibility on public.mdm_devices;

create trigger trg_mdm_devices_set_eligibility
before insert or update of platform, app_version, app_flavor, native_generation, ownership_type, enrollment_mode, is_device_owner, capabilities
on public.mdm_devices
for each row
execute function public.mdm_devices_set_eligibility();

create table if not exists public.mdm_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  device_id text not null,
  command_type text not null,
  status text not null default 'queued',
  reason text,
  payload jsonb not null default '{}'::jsonb,
  requested_by uuid,
  requested_by_role text,
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  command_result jsonb,
  queued_at timestamptz not null default timezone('utc', now()),
  picked_up_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mdm_commands_type_check check (command_type in (
    'lock_device',
    'unlock_device',
    'request_location',
    'start_remote_support',
    'stop_remote_support',
    'install_app',
    'uninstall_app',
    'sync_policy',
    'revoke_device_access',
    'financing_lock',
    'diagnostics_ping'
  )),
  constraint mdm_commands_status_check check (status in (
    'queued',
    'picked_up',
    'running',
    'succeeded',
    'failed',
    'expired',
    'cancelled',
    'rejected'
  )),
  constraint mdm_commands_payload_object_check check (jsonb_typeof(payload) = 'object'),
  constraint mdm_commands_eligibility_snapshot_object_check check (jsonb_typeof(eligibility_snapshot) = 'object')
);

create table if not exists public.mdm_command_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  device_id text not null,
  command_id uuid references public.mdm_commands(id) on delete set null,
  command_type text not null,
  event_type text not null,
  decision text not null,
  reason text,
  actor_id uuid,
  actor_role text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint mdm_command_audit_decision_check check (decision in ('accepted', 'rejected', 'executed', 'failed', 'expired', 'cancelled')),
  constraint mdm_command_audit_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.mdm_remote_support_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  device_id text not null,
  status text not null default 'requested',
  session_mode text not null,
  started_by uuid,
  command_id uuid references public.mdm_commands(id) on delete set null,
  started_at timestamptz,
  expires_at timestamptz not null,
  ended_at timestamptz,
  audit_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint mdm_remote_support_status_check check (status in ('requested', 'active', 'ended', 'expired', 'rejected')),
  constraint mdm_remote_support_session_mode_check check (session_mode in ('attended', 'company_kiosk')),
  constraint mdm_remote_support_audit_metadata_object_check check (jsonb_typeof(audit_metadata) = 'object')
);

create index if not exists idx_mdm_devices_tenant_device on public.mdm_devices (tenant_id, device_id);
create index if not exists idx_mdm_devices_full_mdm on public.mdm_devices (tenant_id, is_full_mdm_eligible);
create index if not exists idx_mdm_commands_device_status on public.mdm_commands (tenant_id, device_id, status, queued_at desc);
create index if not exists idx_mdm_command_audit_device on public.mdm_command_audit (tenant_id, device_id, created_at desc);
create index if not exists idx_mdm_remote_support_device_status on public.mdm_remote_support_sessions (tenant_id, device_id, status, expires_at desc);

alter table public.mdm_devices enable row level security;
alter table public.mdm_commands enable row level security;
alter table public.mdm_command_audit enable row level security;
alter table public.mdm_remote_support_sessions enable row level security;

comment on function public.mdm_android_1023_web_production_eligible is
  'Returns true only for company-owned/company-financed Android 1.0.23 Web Production devices enrolled as Device Owner/Fully Managed/Dedicated Device with mdm_core capability.';
comment on table public.mdm_devices is
  'CpIPOS managed-device registry. Full MDM is limited to Android 1.0.23 Web Production Device Owner devices only.';
comment on table public.mdm_commands is
  'Audited queue for MDM device commands. Application code must validate role, tenant, eligibility, and reason before insert.';
comment on table public.mdm_command_audit is
  'Immutable-style audit trail for MDM command decisions and execution events.';
comment on table public.mdm_remote_support_sessions is
  'Remote support session registry. Silent screen access is not allowed; only attended or company_kiosk sessions are valid.';
