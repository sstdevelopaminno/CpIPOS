-- Print Agent v1
-- Supports local Windows/Electron workers for multi-tenant, multi-branch, multi-device printing.

create table if not exists public.print_agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  device_id uuid references public.branch_devices(id) on delete set null,
  device_code text not null,
  agent_name text not null,
  api_key_hash text not null unique,
  status text not null default 'active' check (status in ('active', 'blocked', 'inactive')),
  last_seen_at timestamptz,
  last_claim_at timestamptz,
  app_version text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, device_code, agent_name)
);

alter table public.print_agents enable row level security;

revoke all on public.print_agents from public, anon, authenticated;
grant select, insert, update, delete on public.print_agents to service_role;

alter table public.print_jobs
  add column if not exists claimed_by_agent_id uuid references public.print_agents(id) on delete set null,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists agent_attempt_id text,
  add column if not exists agent_error_code text;

create index if not exists idx_print_agents_scope_status
  on public.print_agents(tenant_id, branch_id, status, device_code);

create index if not exists idx_print_jobs_agent_claim
  on public.print_jobs(tenant_id, branch_id, status, claim_expires_at, created_at);

create index if not exists idx_print_jobs_claimed_agent
  on public.print_jobs(claimed_by_agent_id, status, claim_expires_at);

drop trigger if exists trg_print_agents_touch on public.print_agents;
create trigger trg_print_agents_touch
before update on public.print_agents
for each row execute function app.touch_updated_at();
