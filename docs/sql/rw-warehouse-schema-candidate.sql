-- Candidate only. Not installed or exposed to browser clients.
begin;
create table public.rw_warehouses (
  tenant_id uuid not null references public.tenants(id), id uuid not null default gen_random_uuid(),
  code text not null check (length(btrim(code)) between 1 and 40),
  name text not null check (length(btrim(name)) between 1 and 120),
  active boolean not null default true, primary key(tenant_id,id), unique(tenant_id,code)
);
create table public.rw_warehouse_balances (
  tenant_id uuid not null, warehouse_id uuid not null, sku text not null check (length(btrim(sku)) between 1 and 40),
  quantity bigint not null default 0 check(quantity>=0),
  carrying_minor bigint not null default 0 check(carrying_minor>=0 and (quantity>0 or carrying_minor=0)),
  primary key(tenant_id,warehouse_id,sku),
  foreign key(tenant_id,warehouse_id) references public.rw_warehouses(tenant_id,id)
);
create table public.rw_warehouse_transfers (
  tenant_id uuid not null, id uuid not null default gen_random_uuid(), warehouse_id uuid not null,
  destination_branch_id uuid not null references public.branches(id),
  status text not null default 'draft' check(status in ('draft','approved','in_transit','partially_received','received','cancelled')),
  created_by uuid not null, created_at timestamptz not null default now(),
  approved_by uuid, approved_at timestamptz,
  primary key(tenant_id,id), unique(tenant_id,id,warehouse_id),
  foreign key(tenant_id,warehouse_id) references public.rw_warehouses(tenant_id,id)
);
create table public.rw_warehouse_transfer_lines (
  tenant_id uuid not null, transfer_id uuid not null, warehouse_id uuid not null, sku text not null,
  destination_product_id uuid not null references public.products(id),
  destination_ingredient_id uuid not null references public.ingredients(id),
  quantity bigint not null check(quantity>0),
  received bigint not null default 0 check(received>=0 and received<=quantity),
  dispatched_minor bigint not null default 0 check(dispatched_minor>=0),
  received_minor bigint not null default 0 check(received_minor>=0 and received_minor<=dispatched_minor),
  primary key(tenant_id,transfer_id,sku),
  unique(tenant_id,transfer_id,destination_ingredient_id),
  check(received<>quantity or received_minor=dispatched_minor),
  foreign key(tenant_id,transfer_id,warehouse_id) references public.rw_warehouse_transfers(tenant_id,id,warehouse_id),
  foreign key(tenant_id,warehouse_id,sku) references public.rw_warehouse_balances(tenant_id,warehouse_id,sku)
);
create table public.rw_warehouse_commands (
  tenant_id uuid not null references public.tenants(id), request_id uuid not null, actor_id uuid not null,
  payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
  primary key(tenant_id,request_id)
);
create table public.rw_warehouse_ledger (
  tenant_id uuid not null, id uuid not null default gen_random_uuid(), request_id uuid not null,
  warehouse_id uuid not null, sku text not null, transfer_id uuid,
  event text not null check(event in ('warehouse_receipt','dispatch','branch_receipt')),
  warehouse_delta bigint not null, transit_delta bigint not null, branch_delta bigint not null,
  warehouse_value_delta bigint not null, transit_value_delta bigint not null, branch_value_delta bigint not null,
  created_at timestamptz not null default now(),
  primary key(tenant_id,id), unique(tenant_id,request_id,sku,event),
  foreign key(tenant_id,request_id) references public.rw_warehouse_commands(tenant_id,request_id),
  foreign key(tenant_id,warehouse_id,sku) references public.rw_warehouse_balances(tenant_id,warehouse_id,sku),
  foreign key(tenant_id,transfer_id,warehouse_id) references public.rw_warehouse_transfers(tenant_id,id,warehouse_id),
  check (
    (event='warehouse_receipt' and transfer_id is null and warehouse_delta>0 and transit_delta=0 and branch_delta=0
      and warehouse_value_delta>=0 and transit_value_delta=0 and branch_value_delta=0)
    or (event='dispatch' and transfer_id is not null and warehouse_delta<0 and transit_delta=-warehouse_delta and branch_delta=0
      and warehouse_value_delta<=0 and transit_value_delta=-warehouse_value_delta and branch_value_delta=0)
    or (event='branch_receipt' and transfer_id is not null and warehouse_delta=0 and transit_delta<0 and branch_delta=-transit_delta
      and warehouse_value_delta=0 and transit_value_delta<=0 and branch_value_delta=-transit_value_delta)
  )
);
-- No table is granted to anon/authenticated. No browser policy.
do $$
declare t text;
begin
  foreach t in array array['rw_warehouses','rw_warehouse_balances','rw_warehouse_transfers',
    'rw_warehouse_transfer_lines','rw_warehouse_commands','rw_warehouse_ledger'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role',t);
  end loop;
end $$;
-- Service role writes to commands/ledger are insert-only; server commands must use transactions.
grant select,insert,update on public.rw_warehouses,public.rw_warehouse_balances,
  public.rw_warehouse_transfers,public.rw_warehouse_transfer_lines to service_role;
grant select,insert on public.rw_warehouse_commands,public.rw_warehouse_ledger to service_role;
commit;
