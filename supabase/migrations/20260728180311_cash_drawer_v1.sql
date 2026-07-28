create table if not exists public.cash_drawer_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  pos_device_id uuid null references public.branch_devices(id) on delete set null,
  printer_profile_id uuid null references public.printer_profiles(id) on delete set null,
  print_job_id uuid null references public.print_jobs(id) on delete set null,
  user_id uuid null references public.users_profiles(id) on delete set null,
  session_id uuid null references public.pos_sessions(id) on delete set null,
  shift_id uuid null references public.shifts(id) on delete set null,
  order_id uuid null references public.orders(id) on delete set null,
  payment_id uuid null references public.payments(id) on delete set null,
  trigger_source text not null default 'manual' check (trigger_source in ('manual', 'cash_payment')),
  reason text null,
  command_status text not null default 'queued' check (command_status in ('queued', 'sent', 'failed')),
  physical_status text not null default 'unknown' check (physical_status in ('open', 'closed', 'unknown', 'unsupported', 'offline')),
  error_code text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.cash_drawer_events enable row level security;
revoke all on public.cash_drawer_events from public, anon, authenticated;
grant select, insert, update, delete on public.cash_drawer_events to service_role;

create index if not exists idx_cash_drawer_events_scope_created
  on public.cash_drawer_events(tenant_id, branch_id, created_at desc);

create index if not exists idx_cash_drawer_events_shift
  on public.cash_drawer_events(shift_id, created_at desc)
  where shift_id is not null;
