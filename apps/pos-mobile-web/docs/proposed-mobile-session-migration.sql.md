# Proposed Mobile Session Migration

Status: proposal only, not applied.

```sql
-- Review before applying. Existing pos_login_contexts and pos_sessions may be sufficient.
create table if not exists public.mobile_login_contexts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid references public.branches(id),
  status text not null default 'active',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.mobile_devices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid references public.branches(id),
  device_name text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
```

Reason: only needed if existing `pos_login_contexts`, `branch_devices`, and `pos_sessions` cannot safely represent mobile contexts/devices.
