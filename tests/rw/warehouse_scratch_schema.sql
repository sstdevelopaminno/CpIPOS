-- Disposable fixtures only; never run on live database.
create role anon; create role authenticated; create role service_role;
create table public.tenants(id uuid primary key,is_active boolean not null);
create table public.users_profiles(id uuid primary key,is_active boolean not null,archived_at timestamptz);
create table public.branches(id uuid primary key,tenant_id uuid not null references tenants(id),is_active boolean not null);
create table public.subscription_packages(id uuid primary key,code text not null);
create table public.tenant_subscription_contracts(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),package_id uuid not null references subscription_packages(id),status text not null,started_at timestamptz,ended_at timestamptz,metadata jsonb,currency text);
create table public.user_branch_roles(tenant_id uuid not null references tenants(id),branch_id uuid not null references branches(id),user_id uuid not null references users_profiles(id),role text not null);
create table public.products(id uuid primary key,tenant_id uuid not null references tenants(id),branch_id uuid not null references branches(id),sku text,is_active boolean,deleted_at timestamptz,stock_deduction_mode text);
create table public.ingredients(id uuid primary key,tenant_id uuid not null references tenants(id),branch_id uuid not null references branches(id),name text not null,base_unit text not null,quantity_on_hand numeric not null,avg_unit_cost numeric not null,last_purchase_unit_cost numeric,updated_at timestamptz);
create table public.recipes(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),branch_id uuid not null references branches(id),product_id uuid not null references products(id),ingredient_id uuid not null references ingredients(id),quantity_per_item numeric not null,applies_when_takeaway_only boolean not null default false);
create type stock_movement_type as enum('purchase','sale_deduction','manual_adjustment','waste','sale_void_restore');
create table public.manager_pin_approvals(id uuid primary key,action text,target_table text,target_id uuid,expires_at timestamptz);
create table public.stock_movements(id uuid primary key,tenant_id uuid not null references tenants(id),branch_id uuid not null references branches(id),ingredient_id uuid not null references ingredients(id),movement_type stock_movement_type,quantity_delta numeric,reason text,ref_table text,ref_id uuid,created_by uuid references users_profiles(id),approval_id uuid references manager_pin_approvals(id),request_id text,unique(tenant_id,branch_id,request_id));

-- Same manual-adjustment approval invariant observed in production.
create schema app;
create function app.enforce_stock_adjustment_approval() returns trigger language plpgsql
set search_path=pg_catalog,public,app as $$
begin
 if new.movement_type='manual_adjustment' then
   if new.approval_id is null then raise exception 'Manual stock adjustment requires approval.'; end if;
   if not exists(select 1 from public.manager_pin_approvals a where a.id=new.approval_id and a.action='stock_adjustment'
     and a.target_table='stock_movements' and a.target_id=new.id and a.expires_at>now()) then
     raise exception 'Stock adjustment approval is invalid or expired.';
   end if;
 end if;
 return new;
end $$;
create trigger trg_stock_adjustment_guard before insert on public.stock_movements
for each row execute function app.enforce_stock_adjustment_approval();
