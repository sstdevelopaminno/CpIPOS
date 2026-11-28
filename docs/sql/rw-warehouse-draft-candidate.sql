-- Candidate only. Do not activate before migration, API and authorization review.
begin;
create function public.rw_create_draft_candidate(p_tenant uuid,p_warehouse uuid,p_branch uuid,p_actor uuid,p_request uuid,p_lines jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
 prior public.rw_warehouse_commands%rowtype;
 line jsonb;
 sku_value text;
 qty bigint;
 product_id_value uuid;
 ingredient_id_value uuid;
 transfer_id_value uuid:=gen_random_uuid();
 payload jsonb:=jsonb_build_object('operation','create_draft','warehouse_id',p_warehouse,'destination_branch_id',p_branch,'lines',p_lines);
 response jsonb;
begin
 if p_tenant is null or p_warehouse is null or p_branch is null or p_actor is null or p_request is null
  or p_lines is null or jsonb_typeof(p_lines)<>'array' then raise exception 'INVALID_COMMAND'; end if;
 if jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'INVALID_LINES'; end if;
 if not exists(select 1 from public.user_branch_roles where tenant_id=p_tenant and user_id=p_actor and role='owner')
  then raise exception 'FORBIDDEN_WAREHOUSE'; end if;
 if (select count(*) from public.tenant_subscription_contracts c
    where c.tenant_id=p_tenant and c.status in ('active','trial') and (c.ended_at is null or c.ended_at>now()))<>1
    or not exists(select 1 from public.tenant_subscription_contracts c join public.subscription_packages p on p.id=c.package_id
    where c.tenant_id=p_tenant and c.status in ('active','trial') and (c.ended_at is null or c.ended_at>now())
    and lower(trim(p.code))='custom' and c.metadata->'sales_modes'->'retail_wholesale'='true'::jsonb
    and not exists(select 1 from unnest(array['takeaway','home','dine_in','buffet_table','delivery','optical_retail','recycling']) k
    where c.metadata->'sales_modes'->k='true'::jsonb)) then raise exception 'RW_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_request::text,0));
 select * into prior from public.rw_warehouse_commands where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or prior.payload<>payload then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.result;
 end if;
 if not exists(select 1 from public.branches where id=p_branch and tenant_id=p_tenant and is_active)
  or not exists(select 1 from public.rw_warehouses where id=p_warehouse and tenant_id=p_tenant and active)
  then raise exception 'INVALID_LOCATION'; end if;
 insert into public.rw_warehouse_transfers(tenant_id,id,warehouse_id,destination_branch_id,created_by)
  values(p_tenant,transfer_id_value,p_warehouse,p_branch,p_actor);
 for line in select value from jsonb_array_elements(p_lines) order by value->>'sku' loop
  if jsonb_typeof(line)<>'object' or jsonb_typeof(line->'sku') is distinct from 'string'
   or jsonb_typeof(line->'quantity') is distinct from 'number' or (line->>'quantity') !~ '^[1-9][0-9]{0,8}$'
   then raise exception 'INVALID_LINE'; end if;
  sku_value:=line->>'sku';
  qty:=(line->>'quantity')::bigint;
  if sku_value<>btrim(sku_value) or length(sku_value) not between 1 and 40 then raise exception 'INVALID_SKU'; end if;
  if not exists(select 1 from public.rw_warehouse_balances where tenant_id=p_tenant and warehouse_id=p_warehouse and sku=sku_value)
   then raise exception 'SKU_NOT_REGISTERED'; end if;
  if (select count(*) from public.products where tenant_id=p_tenant and branch_id=p_branch and sku=sku_value and is_active and deleted_at is null)<>1
   then raise exception 'AMBIGUOUS_DESTINATION_SKU'; end if;
  select p.id into product_id_value from public.products p where p.tenant_id=p_tenant and p.branch_id=p_branch
    and p.sku=sku_value and p.is_active and p.deleted_at is null and p.stock_deduction_mode='recipe_deduction' for update;
  if not found then raise exception 'INVALID_DESTINATION_MAPPING'; end if;
  if (select count(*) from public.recipes where product_id=product_id_value)<>1 then raise exception 'INVALID_DESTINATION_MAPPING'; end if;
  select i.id into ingredient_id_value from public.recipes r join public.ingredients i on i.id=r.ingredient_id
   where r.product_id=product_id_value and r.tenant_id=p_tenant and i.tenant_id=p_tenant
   and r.branch_id=p_branch and i.branch_id=p_branch and i.base_unit='piece' and i.name like 'STOCK:%'
   and r.quantity_per_item=1 and not r.applies_when_takeaway_only for update of i;
  if not found then raise exception 'INVALID_DESTINATION_MAPPING'; end if;
  if (select count(*) from public.recipes where ingredient_id=ingredient_id_value)<>1 then raise exception 'INVALID_DESTINATION_MAPPING'; end if;
  if exists(select 1 from public.rw_warehouse_transfer_lines where tenant_id=p_tenant and transfer_id=transfer_id_value and sku=sku_value)
   then raise exception 'DUPLICATE_SKU'; end if;
  insert into public.rw_warehouse_transfer_lines(tenant_id,transfer_id,warehouse_id,sku,destination_product_id,destination_ingredient_id,quantity)
   values(p_tenant,transfer_id_value,p_warehouse,sku_value,product_id_value,ingredient_id_value,qty);
 end loop;
 response:=jsonb_build_object('transfer_id',transfer_id_value,'status','draft');
 insert into public.rw_warehouse_commands(tenant_id,request_id,actor_id,payload,result)
  values(p_tenant,p_request,p_actor,payload,response);
 return response;
end $$;
revoke all on function public.rw_create_draft_candidate(uuid,uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.rw_create_draft_candidate(uuid,uuid,uuid,uuid,uuid,jsonb) to service_role;
commit;
