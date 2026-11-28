-- Synthetic schema reproduces only columns required by candidate SQL.
-- Run exclusively in a disposable database named rw_warehouse_test.
do $$ begin if current_database() <> 'rw_warehouse_test' then raise exception 'DISPOSABLE_DATABASE_REQUIRED'; end if; end $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create table tenants(id uuid primary key);
create table branches(id uuid primary key,tenant_id uuid not null references tenants,id_dummy text,is_active boolean not null default true);
create table products(id uuid primary key,tenant_id uuid not null references tenants,branch_id uuid not null references branches,sku text not null,is_active boolean not null default true,deleted_at timestamptz,stock_deduction_mode text not null);
create table ingredients(id uuid primary key,tenant_id uuid not null references tenants,branch_id uuid not null references branches,name text not null,base_unit text not null,quantity_on_hand numeric not null,avg_unit_cost numeric not null);
create table recipes(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants,branch_id uuid not null references branches,product_id uuid not null references products,ingredient_id uuid not null references ingredients,quantity_per_item numeric not null,applies_when_takeaway_only boolean not null default false);
create type branch_role as enum ('owner','manager','staff','kitchen','accountant');
create table user_branch_roles(tenant_id uuid not null references tenants,branch_id uuid not null references branches,user_id uuid not null,role branch_role not null);
create table subscription_packages(id uuid primary key,code text not null);
create table tenant_subscription_contracts(tenant_id uuid not null references tenants,package_id uuid not null references subscription_packages,status text not null,ended_at timestamptz,metadata jsonb not null);
create type approval_action as enum ('stock_adjustment');
create table manager_pin_approvals(id uuid primary key,tenant_id uuid not null references tenants,branch_id uuid not null references branches,requested_by uuid not null,approved_by uuid not null,action approval_action not null,target_table text not null,target_id uuid not null,note text,expires_at timestamptz not null,consumed_at timestamptz);
create type stock_movement_type as enum ('manual_adjustment','sale_deduction');
create table stock_movements(id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants,branch_id uuid not null references branches,ingredient_id uuid not null references ingredients,movement_type stock_movement_type not null,quantity_delta numeric not null,reason text not null,ref_table text,ref_id uuid,approval_id uuid references manager_pin_approvals,created_by uuid not null,request_id text,unique(tenant_id,branch_id,request_id));
grant usage on schema public to service_role;
grant select,update on products,ingredients,manager_pin_approvals to service_role;
grant select on recipes,user_branch_roles,branches,tenant_subscription_contracts,subscription_packages to service_role;
grant select,insert on stock_movements to service_role;
insert into tenants values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into branches(id,tenant_id) values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000002');
insert into subscription_packages values ('00000000-0000-0000-0000-000000000021','CUSTOM');
insert into tenant_subscription_contracts values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000021','active',null,'{"sales_modes":{"retail_wholesale":true}}');
insert into user_branch_roles values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000031','owner');
insert into products(id,tenant_id,branch_id,sku,stock_deduction_mode) values
('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','A','recipe_deduction'),
('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','B','recipe_deduction');
insert into ingredients values
('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','STOCK:A','piece',10,2),
('00000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','STOCK:B','piece',0,0);
insert into recipes(tenant_id,branch_id,product_id,ingredient_id,quantity_per_item) values
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000051',1),
('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000052',1);
