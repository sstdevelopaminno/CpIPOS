create extension if not exists pgcrypto;

create table if not exists public.mobile_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  phone text not null,
  points_balance integer not null default 0 check (points_balance >= 0),
  stamp_balance integer not null default 0 check (stamp_balance >= 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, phone)
);

create index if not exists mobile_members_branch_updated_idx
  on public.mobile_members (tenant_id, branch_id, updated_at desc);

create index if not exists mobile_members_phone_idx
  on public.mobile_members (tenant_id, branch_id, phone);

create table if not exists public.mobile_member_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  member_id uuid not null references public.mobile_members(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  order_no text,
  amount numeric(12,2) not null default 0,
  points_delta integer not null default 0,
  stamps_delta integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists mobile_member_transactions_member_idx
  on public.mobile_member_transactions (tenant_id, branch_id, member_id, created_at desc);

create index if not exists mobile_member_transactions_order_idx
  on public.mobile_member_transactions (order_id);

create table if not exists public.mobile_member_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  points_mode text not null default 'amount_rate' check (points_mode in ('manual', 'amount_rate', 'fixed_per_bill')),
  amount_per_point numeric(12,2) not null default 100 check (amount_per_point > 0),
  points_per_amount integer not null default 1 check (points_per_amount >= 0),
  fixed_points_per_bill integer not null default 0 check (fixed_points_per_bill >= 0),
  stamps_mode text not null default 'manual' check (stamps_mode in ('manual', 'amount_rate', 'fixed_per_bill')),
  amount_per_stamp numeric(12,2) not null default 100 check (amount_per_stamp > 0),
  stamps_per_amount integer not null default 1 check (stamps_per_amount >= 0),
  fixed_stamps_per_bill integer not null default 0 check (fixed_stamps_per_bill >= 0),
  qr_enabled boolean not null default true,
  qr_token_ttl_minutes integer not null default 15 check (qr_token_ttl_minutes between 1 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id)
);

create table if not exists public.mobile_member_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  member_id uuid not null references public.mobile_members(id) on delete cascade,
  token text not null unique,
  points integer not null default 0 check (points >= 0),
  stamps integer not null default 0 check (stamps >= 0),
  status text not null default 'active' check (status in ('active', 'redeemed', 'expired', 'void')),
  expires_at timestamptz not null,
  redeemed_order_id uuid references public.orders(id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists mobile_member_qr_tokens_token_idx
  on public.mobile_member_qr_tokens (token);

create index if not exists mobile_member_qr_tokens_member_idx
  on public.mobile_member_qr_tokens (tenant_id, branch_id, member_id, created_at desc);

alter table public.mobile_members enable row level security;
alter table public.mobile_member_transactions enable row level security;
alter table public.mobile_member_settings enable row level security;
alter table public.mobile_member_qr_tokens enable row level security;
