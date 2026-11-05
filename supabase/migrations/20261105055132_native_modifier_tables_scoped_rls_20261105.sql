-- Native Mobile configured menu prerequisite (additive schema catch-up).
create table if not exists public.product_modifier_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  selection_type text not null default 'multiple' check (selection_type in ('single', 'multiple')),
  is_required boolean not null default false,
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer not null default 0 check (max_select >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_modifier_options (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  group_id uuid not null references public.product_modifier_groups(id) on delete cascade,
  name text not null,
  price_delta numeric(12,2) not null default 0,
  is_default boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_modifier_option_ingredients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  option_id uuid not null references public.product_modifier_options(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity_delta_per_item numeric(14,3) not null default 0,
  created_at timestamptz not null default now(),
  unique (option_id, ingredient_id)
);

create index if not exists idx_product_modifier_groups_scope
  on public.product_modifier_groups(tenant_id, branch_id, product_id, is_active, sort_order);

create index if not exists idx_product_modifier_options_scope
  on public.product_modifier_options(tenant_id, branch_id, group_id, is_active, sort_order);

create index if not exists idx_product_modifier_option_ingredients_scope
  on public.product_modifier_option_ingredients(tenant_id, branch_id, option_id, ingredient_id);

-- This additive catch-up is needed because live CpiPOS-001 did not receive
-- the 202607220002 modifier migration. It does not modify product/orders/stock rows.
-- Scope policies match tenant AND branch in a single membership row, not independent IN tests.
alter table public.product_modifier_groups enable row level security;
alter table public.product_modifier_options enable row level security;
alter table public.product_modifier_option_ingredients enable row level security;

drop policy if exists product_modifier_groups_isolation on public.product_modifier_groups;
create policy product_modifier_groups_isolation on public.product_modifier_groups
  for all to authenticated
  using (exists (
    select 1 from public.user_branch_roles r where r.user_id = (select auth.uid())
      and r.tenant_id = product_modifier_groups.tenant_id
      and r.branch_id = product_modifier_groups.branch_id
  ))
  with check (exists (
    select 1 from public.user_branch_roles r where r.user_id = (select auth.uid())
      and r.tenant_id = product_modifier_groups.tenant_id
      and r.branch_id = product_modifier_groups.branch_id
  ));

drop policy if exists product_modifier_options_isolation on public.product_modifier_options;
create policy product_modifier_options_isolation on public.product_modifier_options
  for all to authenticated
  using (exists (
    select 1 from public.user_branch_roles r where r.user_id = (select auth.uid())
      and r.tenant_id = product_modifier_options.tenant_id
      and r.branch_id = product_modifier_options.branch_id
  ))
  with check (exists (
    select 1 from public.user_branch_roles r where r.user_id = (select auth.uid())
      and r.tenant_id = product_modifier_options.tenant_id
      and r.branch_id = product_modifier_options.branch_id
  ));

drop policy if exists product_modifier_option_ingredients_isolation on public.product_modifier_option_ingredients;
create policy product_modifier_option_ingredients_isolation on public.product_modifier_option_ingredients
  for all to authenticated
  using (exists (
    select 1 from public.user_branch_roles r where r.user_id = (select auth.uid())
      and r.tenant_id = product_modifier_option_ingredients.tenant_id
      and r.branch_id = product_modifier_option_ingredients.branch_id
  ))
  with check (exists (
    select 1 from public.user_branch_roles r where r.user_id = (select auth.uid())
      and r.tenant_id = product_modifier_option_ingredients.tenant_id
      and r.branch_id = product_modifier_option_ingredients.branch_id
  ));
