-- DRAFT ONLY: isolated PostgreSQL acceptance, NOT a Supabase migration.
-- No client access, no automatic activation, no finance posting.
begin;
create schema rw_warehouse_candidate;
revoke all on schema rw_warehouse_candidate from public, anon, authenticated, service_role;
create table rw_warehouse_candidate.warehouses (
 tenant_id uuid not null references public.tenants(id), id uuid not null default gen_random_uuid(),
 code text not null check(length(trim(code))>0), name text not null check(length(trim(name))>0),
 active boolean not null default true, primary key(tenant_id,id), unique(tenant_id,code)
);
create table rw_warehouse_candidate.items (
 tenant_id uuid not null references public.tenants(id), id uuid not null default gen_random_uuid(),
 sku text not null check(length(trim(sku))>0), name text not null,
 active boolean not null default true, primary key(tenant_id,id), unique(tenant_id,sku)
);
-- Product IDs are branch-specific; never infer a mapping by product name.
create table rw_warehouse_candidate.branch_links (
 tenant_id uuid not null, item_id uuid not null, branch_id uuid not null references public.branches(id),
 product_id uuid not null references public.products(id), ingredient_id uuid not null references public.ingredients(id),
 primary key(tenant_id,item_id,branch_id), unique(tenant_id,branch_id,product_id), unique(tenant_id,branch_id,ingredient_id),
 foreign key(tenant_id,item_id) references rw_warehouse_candidate.items(tenant_id,id)
);
create table rw_warehouse_candidate.balances (
 tenant_id uuid not null, warehouse_id uuid not null, item_id uuid not null,
 quantity bigint not null default 0 check(quantity between 0 and 1000000000000),
 value_minor bigint not null default 0 check(value_minor between 0 and 1000000000000000),
 primary key(tenant_id,warehouse_id,item_id),
 foreign key(tenant_id,warehouse_id) references rw_warehouse_candidate.warehouses(tenant_id,id),
 foreign key(tenant_id,item_id) references rw_warehouse_candidate.items(tenant_id,id),
 check(quantity<>0 or value_minor=0)
);
create table rw_warehouse_candidate.transfers (
 tenant_id uuid not null, id uuid not null default gen_random_uuid(), warehouse_id uuid not null, item_id uuid not null,
 branch_id uuid not null references public.branches(id), product_id uuid not null references public.products(id),
 ingredient_id uuid not null references public.ingredients(id),
 quantity bigint not null check(quantity>0), value_minor bigint not null check(value_minor>=0),
 received_quantity bigint not null default 0 check(received_quantity>=0 and received_quantity<=quantity),
 received_value_minor bigint not null default 0 check(received_value_minor>=0 and received_value_minor<=value_minor),
 state text not null default 'in_transit' check(state in ('in_transit','partially_received','received')),
 dispatched_by uuid not null references public.users_profiles(id), dispatched_at timestamptz not null default now(),
 primary key(tenant_id,id),
 foreign key(tenant_id,warehouse_id,item_id) references rw_warehouse_candidate.balances(tenant_id,warehouse_id,item_id),
 check((state='in_transit' and received_quantity=0) or
 (state='partially_received' and received_quantity>0 and received_quantity<quantity) or
 (state='received' and received_quantity=quantity and received_value_minor=value_minor))
);
create table rw_warehouse_candidate.events (
 tenant_id uuid not null references public.tenants(id), request_id uuid not null,
 actor uuid not null references public.users_profiles(id), action text not null check(action in ('receive_warehouse','dispatch','receive_branch')),
 payload jsonb not null, result jsonb not null, created_at timestamptz not null default now(),
 primary key(tenant_id,request_id)
);
-- One verified supplier receipt line may not be counted twice even with a new request key.
create unique index rw_warehouse_receipt_source_once on rw_warehouse_candidate.events
(tenant_id,(payload->>'source_ref')) where action='receive_warehouse';
alter table rw_warehouse_candidate.warehouses enable row level security;
alter table rw_warehouse_candidate.items enable row level security;
alter table rw_warehouse_candidate.branch_links enable row level security;
alter table rw_warehouse_candidate.balances enable row level security;
alter table rw_warehouse_candidate.transfers enable row level security;
alter table rw_warehouse_candidate.events enable row level security;

create function rw_warehouse_candidate.require_actor(p_tenant uuid,p_actor uuid,p_branch uuid default null)
returns void language plpgsql security invoker set search_path=pg_catalog,rw_warehouse_candidate as $$
declare v_count integer; v_modes jsonb; v_currency text;
begin
 if p_tenant is null or p_actor is null then raise exception 'rw_scope_required'; end if;
 if not exists(select 1 from public.tenants t where t.id=p_tenant and t.is_active) or
    not exists(select 1 from public.users_profiles u where u.id=p_actor and u.is_active and u.archived_at is null)
 then raise exception 'rw_actor_forbidden'; end if;
 select count(*) into v_count from public.tenant_subscription_contracts c
 where c.tenant_id=p_tenant and c.status in ('active','trial') and (c.started_at is null or c.started_at<=now()) and (c.ended_at is null or c.ended_at>now());
 if v_count<>1 then raise exception 'rw_contract_ambiguous'; end if;
 select c.metadata->'sales_modes',c.currency into v_modes,v_currency
 from public.tenant_subscription_contracts c join public.subscription_packages p on p.id=c.package_id
 where c.tenant_id=p_tenant and c.status in ('active','trial') and (c.started_at is null or c.started_at<=now()) and (c.ended_at is null or c.ended_at>now()) and p.code='custom';
 if v_modes is null or v_modes->'retail_wholesale' is distinct from 'true'::jsonb or v_currency is distinct from 'THB'
 or exists(select 1 from unnest(array['takeaway','home','dine_in','buffet_table','delivery','optical_retail','recycling']) as k(key) where v_modes->k.key='true'::jsonb)
 then raise exception 'rw_custom_thb_required'; end if;
 if p_branch is null then
   if not exists(select 1 from public.user_branch_roles r join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id and b.is_active where r.tenant_id=p_tenant and r.user_id=p_actor and r.role::text='owner')
   then raise exception 'rw_warehouse_owner_required'; end if;
 else
   if not exists(select 1 from public.user_branch_roles r join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id and b.is_active where r.tenant_id=p_tenant and r.branch_id=p_branch and r.user_id=p_actor and r.role::text in ('owner','manager'))
   then raise exception 'rw_branch_manager_required'; end if;
 end if;
end $$;

create function rw_warehouse_candidate.prior_event(p_tenant uuid,p_actor uuid,p_request uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,rw_warehouse_candidate as $$
declare e rw_warehouse_candidate.events%rowtype;
begin
 if p_request is null then raise exception 'rw_request_id_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_request::text,0));
 select * into e from rw_warehouse_candidate.events where tenant_id=p_tenant and request_id=p_request;
 if found then
   if e.action<>p_action or e.actor<>p_actor or e.payload<>p_payload then raise exception 'rw_idempotency_conflict'; end if;
   return e.result;
 end if;
 return null;
end $$;

-- Exact remaining carrying value on final units, half-up for partial movements.
create function rw_warehouse_candidate.allocate_value(p_value bigint,p_total bigint,p_units bigint)
returns bigint language plpgsql immutable security invoker set search_path=pg_catalog as $$
begin
 if p_value is null or p_total is null or p_units is null or p_value<0 or p_total<=0 or p_units<=0 or p_units>p_total then raise exception 'rw_invalid_allocation'; end if;
 if p_units=p_total then return p_value; end if;
 return round(p_value::numeric*p_units/p_total)::bigint;
end $$;

create function rw_warehouse_candidate.receive_warehouse(p_tenant uuid,p_actor uuid,p_request uuid,p_warehouse uuid,p_item uuid,p_units bigint,p_cost_minor bigint,p_source_ref text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,rw_warehouse_candidate as $$
declare v_payload jsonb; v_result jsonb; v_balance rw_warehouse_candidate.balances%rowtype;
begin
 perform rw_warehouse_candidate.require_actor(p_tenant,p_actor);
 if p_units is null or p_units not between 1 and 1000000000 or p_cost_minor is null or p_cost_minor not between 0 and 1000000000000 or nullif(trim(p_source_ref),'') is null or length(p_source_ref)>160 then raise exception 'rw_invalid_receipt'; end if;
 v_payload:=jsonb_build_object('warehouse',p_warehouse,'item',p_item,'units',p_units,'cost_minor',p_cost_minor,'source_ref',trim(p_source_ref));
 v_result:=rw_warehouse_candidate.prior_event(p_tenant,p_actor,p_request,'receive_warehouse',v_payload);
 if v_result is not null then return v_result; end if;
 if not exists(select 1 from rw_warehouse_candidate.warehouses where tenant_id=p_tenant and id=p_warehouse and active) or not exists(select 1 from rw_warehouse_candidate.items where tenant_id=p_tenant and id=p_item and active) then raise exception 'rw_warehouse_item_not_found'; end if;
 insert into rw_warehouse_candidate.balances(tenant_id,warehouse_id,item_id) values(p_tenant,p_warehouse,p_item) on conflict do nothing;
 update rw_warehouse_candidate.balances set quantity=quantity+p_units,value_minor=value_minor+p_cost_minor
 where tenant_id=p_tenant and warehouse_id=p_warehouse and item_id=p_item returning * into v_balance;
 v_result:=jsonb_build_object('quantity',v_balance.quantity,'value_minor',v_balance.value_minor);
 insert into rw_warehouse_candidate.events(tenant_id,request_id,actor,action,payload,result) values(p_tenant,p_request,p_actor,'receive_warehouse',v_payload,v_result);
 return v_result;
end $$;

-- Verify a dedicated one-piece stock recipe. Lock catalogue and ingredient;
-- no auto-created branch product or recipe and no matching by name.
create function rw_warehouse_candidate.verify_link(p_tenant uuid,p_item uuid,p_branch uuid)
returns rw_warehouse_candidate.branch_links language plpgsql security invoker set search_path=pg_catalog,rw_warehouse_candidate as $$
declare l rw_warehouse_candidate.branch_links%rowtype; v_product uuid;
begin
 select * into l from rw_warehouse_candidate.branch_links where tenant_id=p_tenant and item_id=p_item and branch_id=p_branch for share;
 if not found then raise exception 'rw_branch_link_missing'; end if;
 select p.id into v_product
 from public.products p join public.branches b on b.id=p.branch_id and b.tenant_id=p.tenant_id and b.is_active
 join rw_warehouse_candidate.items w on w.tenant_id=p.tenant_id and w.id=p_item and w.active and w.sku=p.sku
 join public.ingredients i on i.id=l.ingredient_id and i.tenant_id=p.tenant_id and i.branch_id=p.branch_id
 where p.id=l.product_id and p.tenant_id=p_tenant and p.branch_id=p_branch and p.is_active and p.deleted_at is null
 and p.stock_deduction_mode='unit_only' and i.base_unit='piece' and i.name like 'STOCK:%'
 for update of p,i;
 if not found then raise exception 'rw_branch_link_invalid'; end if;
 if (select count(*) from public.recipes r where r.tenant_id=p_tenant and r.branch_id=p_branch and r.product_id=l.product_id)<>1
 or (select count(*) from public.recipes r where r.tenant_id=p_tenant and r.branch_id=p_branch and r.ingredient_id=l.ingredient_id)<>1
 or not exists(select 1 from public.recipes r where r.tenant_id=p_tenant and r.branch_id=p_branch and r.product_id=l.product_id and r.ingredient_id=l.ingredient_id and r.quantity_per_item=1 and not r.applies_when_takeaway_only)
 then raise exception 'rw_branch_recipe_invalid'; end if;
 return l;
end $$;

create function rw_warehouse_candidate.dispatch(p_tenant uuid,p_actor uuid,p_request uuid,p_warehouse uuid,p_item uuid,p_branch uuid,p_units bigint)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,rw_warehouse_candidate as $$
declare v_payload jsonb; v_result jsonb; b rw_warehouse_candidate.balances%rowtype; l rw_warehouse_candidate.branch_links%rowtype; v_transfer uuid; v_cost bigint;
begin
 perform rw_warehouse_candidate.require_actor(p_tenant,p_actor);
 if p_branch is null or p_units is null or p_units not between 1 and 1000000000 then raise exception 'rw_invalid_dispatch'; end if;
 v_payload:=jsonb_build_object('warehouse',p_warehouse,'item',p_item,'branch',p_branch,'units',p_units);
 v_result:=rw_warehouse_candidate.prior_event(p_tenant,p_actor,p_request,'dispatch',v_payload);
 if v_result is not null then return v_result; end if;
 if not exists(select 1 from rw_warehouse_candidate.warehouses where tenant_id=p_tenant and id=p_warehouse and active) then raise exception 'rw_warehouse_not_found'; end if;
 select * into b from rw_warehouse_candidate.balances where tenant_id=p_tenant and warehouse_id=p_warehouse and item_id=p_item for update;
 if not found or b.quantity<p_units then raise exception 'rw_warehouse_insufficient'; end if;
 l:=rw_warehouse_candidate.verify_link(p_tenant,p_item,p_branch);
 v_cost:=rw_warehouse_candidate.allocate_value(b.value_minor,b.quantity,p_units);
 update rw_warehouse_candidate.balances set quantity=quantity-p_units,value_minor=value_minor-v_cost where tenant_id=p_tenant and warehouse_id=p_warehouse and item_id=p_item;
 insert into rw_warehouse_candidate.transfers(tenant_id,warehouse_id,item_id,branch_id,product_id,ingredient_id,quantity,value_minor,dispatched_by)
 values(p_tenant,p_warehouse,p_item,p_branch,l.product_id,l.ingredient_id,p_units,v_cost,p_actor) returning id into v_transfer;
 v_result:=jsonb_build_object('transfer_id',v_transfer,'state','in_transit','quantity',p_units,'value_minor',v_cost);
 insert into rw_warehouse_candidate.events(tenant_id,request_id,actor,action,payload,result) values(p_tenant,p_request,p_actor,'dispatch',v_payload,v_result);
 return v_result;
end $$;

-- Receipt is the only point that credits the canonical branch ingredient.
-- A manual_adjustment movement is used provisionally; Finance classification
-- and all legacy absolute stock editors need separate integration UAT.
create function rw_warehouse_candidate.receive_branch(p_tenant uuid,p_actor uuid,p_request uuid,p_transfer uuid,p_branch uuid,p_units bigint)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,rw_warehouse_candidate as $$
declare v_payload jsonb; v_result jsonb; t rw_warehouse_candidate.transfers%rowtype; l rw_warehouse_candidate.branch_links%rowtype; i public.ingredients%rowtype; v_cost bigint; v_average numeric; v_state text;
begin
 if p_branch is null then raise exception 'rw_scope_required'; end if;
 perform rw_warehouse_candidate.require_actor(p_tenant,p_actor,p_branch);
 if p_units is null or p_units not between 1 and 1000000000 then raise exception 'rw_invalid_branch_receipt'; end if;
 v_payload:=jsonb_build_object('transfer',p_transfer,'branch',p_branch,'units',p_units);
 v_result:=rw_warehouse_candidate.prior_event(p_tenant,p_actor,p_request,'receive_branch',v_payload);
 if v_result is not null then return v_result; end if;
 select * into t from rw_warehouse_candidate.transfers where tenant_id=p_tenant and id=p_transfer and branch_id=p_branch for update;
 if not found then raise exception 'rw_transfer_not_found'; end if;
 if p_units>t.quantity-t.received_quantity then raise exception 'rw_transfer_over_receipt'; end if;
 l:=rw_warehouse_candidate.verify_link(p_tenant,t.item_id,p_branch);
 if l.product_id<>t.product_id or l.ingredient_id<>t.ingredient_id then raise exception 'rw_transfer_mapping_changed'; end if;
 select * into i from public.ingredients where tenant_id=p_tenant and branch_id=p_branch and id=t.ingredient_id for update;
 if not found or i.quantity_on_hand<0 or i.quantity_on_hand<>trunc(i.quantity_on_hand) or i.avg_unit_cost is null or i.avg_unit_cost<0 or (i.quantity_on_hand>0 and i.avg_unit_cost=0) then raise exception 'rw_branch_cost_reconciliation_required'; end if;
 v_cost:=rw_warehouse_candidate.allocate_value(t.value_minor-t.received_value_minor,t.quantity-t.received_quantity,p_units);
 v_average:=round((i.quantity_on_hand*i.avg_unit_cost+v_cost::numeric/100)/(i.quantity_on_hand+p_units),4);
 update public.ingredients set quantity_on_hand=quantity_on_hand+p_units,avg_unit_cost=v_average,updated_at=now()
 where tenant_id=p_tenant and branch_id=p_branch and id=t.ingredient_id;
 insert into public.stock_movements(id,tenant_id,branch_id,ingredient_id,movement_type,quantity_delta,reason,ref_table,ref_id,created_by,request_id)
 values(gen_random_uuid(),p_tenant,p_branch,t.ingredient_id,'manual_adjustment',p_units,'RW internal warehouse receipt (candidate)','rw_warehouse_transfers',t.id,p_actor,'rw:'||p_request::text);
 v_state:=case when t.received_quantity+p_units=t.quantity then 'received' else 'partially_received' end;
 update rw_warehouse_candidate.transfers set received_quantity=received_quantity+p_units,received_value_minor=received_value_minor+v_cost,state=v_state
 where tenant_id=p_tenant and id=t.id;
 v_result:=jsonb_build_object('transfer_id',t.id,'state',v_state,'received_quantity',t.received_quantity+p_units,'received_value_minor',t.received_value_minor+v_cost,'branch_quantity',i.quantity_on_hand+p_units);
 insert into rw_warehouse_candidate.events(tenant_id,request_id,actor,action,payload,result) values(p_tenant,p_request,p_actor,'receive_branch',v_payload,v_result);
 return v_result;
end $$;
revoke all on all tables in schema rw_warehouse_candidate from public,anon,authenticated,service_role;
revoke all on all functions in schema rw_warehouse_candidate from public,anon,authenticated,service_role;
commit;
