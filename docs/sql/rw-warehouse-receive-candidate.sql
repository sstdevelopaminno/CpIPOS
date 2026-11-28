-- Candidate only; isolated UAT and finance integration required.
begin;
create function public.rw_receive_candidate(
  p_tenant uuid,p_transfer uuid,p_actor uuid,p_request uuid,p_sku text,p_quantity bigint
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  h public.rw_warehouse_transfers%rowtype;
  l public.rw_warehouse_transfer_lines%rowtype;
  i public.ingredients%rowtype;
  prior public.rw_warehouse_commands%rowtype;
  amount bigint;
  new_status text;
  command_payload jsonb := jsonb_build_object('operation','receive','transfer_id',p_transfer,'sku',p_sku,'quantity',p_quantity);
  response jsonb;
begin
  if p_tenant is null or p_transfer is null or p_actor is null or p_request is null or p_sku is null
    or p_quantity is null or p_quantity<=0 then raise exception 'INVALID_COMMAND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_request::text,0));
  select * into h from public.rw_warehouse_transfers where tenant_id=p_tenant and id=p_transfer for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND'; end if;
  if not exists(select 1 from public.user_branch_roles where tenant_id=p_tenant
    and branch_id=h.destination_branch_id and user_id=p_actor and role in ('owner','manager'))
    then raise exception 'FORBIDDEN_BRANCH'; end if;
  if (select count(*) from public.tenant_subscription_contracts c
    where c.tenant_id=p_tenant and c.status in ('active','trial') and (c.ended_at is null or c.ended_at>now()))<>1
    or not exists(select 1 from public.tenant_subscription_contracts c join public.subscription_packages p on p.id=c.package_id
    where c.tenant_id=p_tenant and c.status in ('active','trial') and (c.ended_at is null or c.ended_at>now())
    and lower(trim(p.code))='custom' and c.metadata->'sales_modes'->'retail_wholesale'='true'::jsonb
    and not exists(select 1 from unnest(array['takeaway','home','dine_in','buffet_table','delivery','optical_retail','recycling']) k
    where c.metadata->'sales_modes'->k='true'::jsonb)) then raise exception 'RW_REQUIRED'; end if;
  select * into prior from public.rw_warehouse_commands where tenant_id=p_tenant and request_id=p_request;
  if found then
    if prior.actor_id<>p_actor or prior.payload<>command_payload then raise exception 'REQUEST_CONFLICT'; end if;
    return prior.result;
  end if;
  if h.status not in ('in_transit','partially_received') then raise exception 'INVALID_TRANSITION'; end if;
  if not exists(select 1 from public.branches where tenant_id=p_tenant and id=h.destination_branch_id and is_active)
    then raise exception 'INVALID_LOCATION'; end if;
  select * into l from public.rw_warehouse_transfer_lines where tenant_id=p_tenant and transfer_id=p_transfer and sku=p_sku for update;
  if not found then raise exception 'LINE_NOT_FOUND'; end if;
  if p_quantity>l.quantity-l.received then raise exception 'OVER_RECEIPT'; end if;
  perform 1 from public.products where id=l.destination_product_id and tenant_id=p_tenant and branch_id=h.destination_branch_id
    and sku=l.sku and is_active and deleted_at is null and stock_deduction_mode='recipe_deduction' for update;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  select * into i from public.ingredients where id=l.destination_ingredient_id and tenant_id=p_tenant
    and branch_id=h.destination_branch_id and base_unit='piece' and name like 'STOCK:%' for update;
  if not found then raise exception 'INGREDIENT_NOT_FOUND'; end if;
  if (select count(*) from public.recipes where product_id=l.destination_product_id)<>1
    or (select count(*) from public.recipes where ingredient_id=l.destination_ingredient_id)<>1
    or not exists(select 1 from public.recipes where product_id=l.destination_product_id and ingredient_id=l.destination_ingredient_id
      and tenant_id=p_tenant and branch_id=h.destination_branch_id and quantity_per_item=1 and not applies_when_takeaway_only)
    then raise exception 'AMBIGUOUS_STOCK_MAPPING'; end if;
  -- Exact residual on final receipt; no revenue or arbitrary GL account.
  amount := case when p_quantity=l.quantity-l.received then l.dispatched_minor-l.received_minor
    else floor((l.dispatched_minor-l.received_minor)::numeric*p_quantity/(l.quantity-l.received))::bigint end;
  -- Fail closed for negative or fractional starting balance; finance must verify the
  -- existing avg_unit_cost precision/currency and moving-average policy before release.
  if i.quantity_on_hand<0 or i.quantity_on_hand<>trunc(i.quantity_on_hand) or i.avg_unit_cost<0
    then raise exception 'UNSUPPORTED_BRANCH_VALUATION'; end if;
  update public.ingredients set quantity_on_hand=quantity_on_hand+p_quantity,
    avg_unit_cost=(i.quantity_on_hand*i.avg_unit_cost+amount::numeric/100)/(i.quantity_on_hand+p_quantity)
    where id=i.id and tenant_id=p_tenant and branch_id=h.destination_branch_id;
  update public.rw_warehouse_transfer_lines set received=received+p_quantity,received_minor=received_minor+amount
    where tenant_id=p_tenant and transfer_id=p_transfer and sku=p_sku;
  new_status := case when exists(select 1 from public.rw_warehouse_transfer_lines
    where tenant_id=p_tenant and transfer_id=p_transfer and received<quantity) then 'partially_received' else 'received' end;
  response := jsonb_build_object('status',new_status,'transfer_id',p_transfer,'sku',p_sku,'received',p_quantity);
  insert into public.rw_warehouse_commands(tenant_id,request_id,actor_id,payload,result)
    values(p_tenant,p_request,p_actor,command_payload,response);
  insert into public.stock_movements(tenant_id,branch_id,ingredient_id,movement_type,quantity_delta,reason,ref_table,ref_id,created_by,request_id)
    values(p_tenant,h.destination_branch_id,i.id,'manual_adjustment',p_quantity,'RW warehouse receipt','rw_warehouse_transfers',p_transfer,p_actor,'rw-receive:'||p_request::text);
  insert into public.rw_warehouse_ledger(tenant_id,request_id,warehouse_id,sku,transfer_id,event,
    warehouse_delta,transit_delta,branch_delta,warehouse_value_delta,transit_value_delta,branch_value_delta)
    values(p_tenant,p_request,h.warehouse_id,p_sku,p_transfer,'branch_receipt',0,-p_quantity,p_quantity,0,-amount,amount);
  update public.rw_warehouse_transfers set status=new_status where tenant_id=p_tenant and id=p_transfer;
  return response;
end $$;
revoke all on function public.rw_receive_candidate(uuid,uuid,uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.rw_receive_candidate(uuid,uuid,uuid,uuid,text,bigint) to service_role;
commit;
