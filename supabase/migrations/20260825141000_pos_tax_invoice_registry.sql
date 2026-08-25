begin;

create table if not exists public.pos_tax_invoice_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  entity_type text not null check (entity_type in ('company','limited_partnership','shop','individual')),
  display_name text not null,
  tax_id text not null check (tax_id ~ '^[0-9]{13}$'),
  address_line text not null,
  subdistrict text not null,
  district text not null,
  province text not null,
  postal_code text not null check (postal_code ~ '^[0-9]{5}$'),
  is_active boolean not null default true,
  created_by uuid null references public.users_profiles(id) on delete set null,
  updated_by uuid null references public.users_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_pos_tax_invoice_profiles_scope_tax_id
  on public.pos_tax_invoice_profiles(tenant_id, branch_id, tax_id)
  where is_active = true;
create index if not exists idx_pos_tax_invoice_profiles_scope_name
  on public.pos_tax_invoice_profiles(tenant_id, branch_id, display_name);

create table if not exists public.pos_tax_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  profile_id uuid not null references public.pos_tax_invoice_profiles(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  invoice_no text not null,
  buyer_snapshot jsonb not null default '{}'::jsonb,
  seller_snapshot jsonb not null default '{}'::jsonb,
  order_snapshot jsonb not null default '{}'::jsonb,
  tax_snapshot jsonb not null default '{}'::jsonb,
  items_snapshot jsonb not null default '[]'::jsonb,
  payments_snapshot jsonb not null default '[]'::jsonb,
  paper_width_mm integer not null default 58 check (paper_width_mm in (58,80)),
  print_count integer not null default 0 check (print_count >= 0),
  issued_by uuid null references public.users_profiles(id) on delete set null,
  issued_at timestamptz not null default now(),
  last_printed_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, order_id),
  unique (tenant_id, branch_id, invoice_no)
);

create index if not exists idx_pos_tax_invoices_profile
  on public.pos_tax_invoices(tenant_id, branch_id, profile_id, issued_at desc);
create index if not exists idx_pos_tax_invoices_issued_at
  on public.pos_tax_invoices(tenant_id, branch_id, issued_at desc);

alter table public.pos_tax_invoice_profiles enable row level security;
alter table public.pos_tax_invoices enable row level security;

revoke all on public.pos_tax_invoice_profiles from anon, authenticated;
revoke all on public.pos_tax_invoices from anon, authenticated;

comment on table public.pos_tax_invoice_profiles is 'Tenant/branch scoped buyer registry for POS tax invoice issuance. Service-role API only.';
comment on table public.pos_tax_invoices is 'Immutable issuance snapshots for POS tax invoices; one tax invoice identity per completed order.';

commit;
