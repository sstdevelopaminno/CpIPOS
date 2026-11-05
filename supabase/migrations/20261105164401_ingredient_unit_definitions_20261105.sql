begin;

create table if not exists public.ingredient_unit_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  unit_value text not null,
  label_th text not null,
  label_en text not null,
  calculation_kind text not null default 'count'
    check (calculation_kind in ('weight','count')),
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ingredient_unit_definitions_unit_value_not_blank
    check (length(trim(unit_value)) between 1 and 64),
  constraint ingredient_unit_definitions_label_th_not_blank
    check (length(trim(label_th)) between 1 and 80),
  constraint ingredient_unit_definitions_label_en_not_blank
    check (length(trim(label_en)) between 1 and 80),
  constraint ingredient_unit_definitions_scope_value_key
    unique (tenant_id, branch_id, unit_value)
);

create index if not exists idx_ingredient_unit_definitions_scope_active_sort
  on public.ingredient_unit_definitions (tenant_id, branch_id, is_active, sort_order, created_at);

create unique index if not exists idx_ingredient_unit_definitions_scope_active_label_th
  on public.ingredient_unit_definitions (tenant_id, branch_id, lower(trim(label_th)))
  where is_active;

alter table public.ingredient_unit_definitions enable row level security;

revoke all on table public.ingredient_unit_definitions from anon, authenticated;
grant select, insert, update, delete on table public.ingredient_unit_definitions to service_role;

insert into public.ingredient_unit_definitions (
  tenant_id, branch_id, unit_value, label_th, label_en,
  calculation_kind, is_system, is_active, sort_order
)
select b.tenant_id, b.id, defaults.unit_value, defaults.label_th, defaults.label_en,
       defaults.calculation_kind, true, true, defaults.sort_order
from public.branches b
cross join (
  values
    ('gram','กรัม','gram','weight',10),
    ('kg','กิโลกรัม','kg','weight',20),
    ('khid','ขีด','khid','weight',30),
    ('bag','ถุง','bag','weight',40),
    ('ลูก','ลูก','piece (round)','count',50),
    ('ชิ้น','ชิ้น','piece','count',60)
) as defaults(unit_value,label_th,label_en,calculation_kind,sort_order)
on conflict (tenant_id, branch_id, unit_value) do nothing;

commit;
