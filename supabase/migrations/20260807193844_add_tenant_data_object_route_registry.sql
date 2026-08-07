create table if not exists public.tenant_data_object_routes (
  object_type text not null,
  object_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (object_type, object_id)
);

create index if not exists idx_tenant_data_object_routes_tenant_branch
  on public.tenant_data_object_routes (tenant_id, branch_id, object_type);

alter table public.tenant_data_object_routes enable row level security;
revoke all on table public.tenant_data_object_routes from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_data_object_routes to service_role;

comment on table public.tenant_data_object_routes is
  'Server-only object-to-tenant routing registry for business objects that may live in CpiPOS-002. Current authoritative home is always resolved from tenant_data_lifecycle.data_home; this table never overrides lifecycle routing.';

insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'products', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.products
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();
insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'ingredients', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.ingredients
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();
insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'recipes', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.recipes
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();
insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'orders', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.orders
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();
insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'order_items', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.order_items
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();
insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'payments', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.payments
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();
insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'stock_movements', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.stock_movements
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();
insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'dining_tables', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.dining_tables
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();
insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'table_bill_sessions', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.table_bill_sessions
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();
insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'table_qr_sessions', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.table_qr_sessions
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();
insert into public.tenant_data_object_routes (object_type, object_id, tenant_id, branch_id, metadata)
select 'table_qr_orders', id, tenant_id, branch_id, jsonb_build_object('seeded_from','CpiPOS-001') from public.table_qr_orders
on conflict (object_type, object_id) do update set tenant_id=excluded.tenant_id, branch_id=excluded.branch_id, updated_at=now();
