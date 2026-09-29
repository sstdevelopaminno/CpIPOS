alter table public.manager_pin_approvals
  add column if not exists consumed_at timestamptz;

create index if not exists idx_manager_pin_approvals_unconsumed
  on public.manager_pin_approvals(tenant_id, branch_id, requested_by, action, expires_at)
  where consumed_at is null;

comment on column public.manager_pin_approvals.consumed_at is
  'Set when a one-time approval is consumed by a mutating action. CpiPOS AI requires unconsumed approvals to prevent replay.';
