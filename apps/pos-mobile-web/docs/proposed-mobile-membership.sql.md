# Proposed Mobile Membership Schema

Status: proposal only, not applied.

The mobile UI now expects these tables for member search, creation, bill attachment, point/stamp balances, and member history.

```sql
create table if not exists public.mobile_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  name text not null,
  phone text not null,
  points_balance integer not null default 0,
  stamp_balance integer not null default 0,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, phone)
);

create index if not exists mobile_members_scope_phone_idx
  on public.mobile_members (tenant_id, branch_id, phone);

create index if not exists mobile_members_scope_name_idx
  on public.mobile_members (tenant_id, branch_id, name);

create table if not exists public.mobile_member_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  member_id uuid not null references public.mobile_members(id),
  order_id uuid references public.orders(id),
  order_no text,
  amount numeric not null default 0,
  points_delta integer not null default 0,
  stamps_delta integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists mobile_member_transactions_member_created_idx
  on public.mobile_member_transactions (tenant_id, branch_id, member_id, created_at desc);
```

## Takeaway RPC Extension

`mobile_takeaway_hold_bill` and `mobile_takeaway_checkout_bill` should accept optional member fields:

```sql
p_member_id uuid default null,
p_member_points integer default 0,
p_member_stamps integer default 0
```

When a member is supplied, the RPC should update order metadata with `member_id`, `member_points_earned`, and `member_stamps_earned`. Checkout should also insert a `mobile_member_transactions` row and increment `mobile_members.points_balance` / `stamp_balance` in the same transaction as payment completion.

Until this SQL is reviewed and applied to the shared Supabase database, the new member API endpoints will return a database error because the tables do not exist yet.
