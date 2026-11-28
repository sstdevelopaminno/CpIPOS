-- Candidate; apply only after rw-warehouse-schema-candidate on isolated DB.
-- Requires verified approval issuance and authenticated server authorization before activation.
begin;
create function public.rw_dispatch_candidate(
  p_tenant uuid,p_transfer uuid,p_actor uuid,p_request uuid
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  h public.rw_warehouse_transfers%rowtype;
  l public.rw_warehouse_transfer_lines%rowtype;
  bal public.rw_warehouse_balances%rowtype;
  prior public.rw_warehouse_commands%rowtype;
  amount bigint;
  payload jsonb := jsonb_build_object('operation','dispatch','transfer_id',p_transfer);
  response jsonb := jsonb_build_object('status','in_transit','transfer_id',p_transfer);
begin
  if p_tenant is null or p_transfer is null or p_actor is null or p_request is null then
    raise exception 'INVALID_COMMAND'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || p_request::text,0));
  select * into h from public.rw_warehouse_transfers where tenant_id=p_tenant and id=p_transfer for update;
  if not found then raise exception 'TRANSFER_NOT_FOUND'; end if;
  -- Owner only until a warehouse-specific role is available.
  if not exists(select 1 from public.user_branch_roles where tenant_id=p_tenant
    and user_id=p_actor and role='owner') then raise exception 'FORBIDDEN_WAREHOUSE'; end if;
  if (select count(*) from public.tenant_subscription_contracts c
    where c.tenant_id=p_tenant and c.status in ('active','trial') and (c.ended_at is null or c.ended_at>now()))<>1
    or not exists(select 1 from public.tenant_subscription_contracts c join public.subscription_packages p on p.id=c.package_id
    where c.tenant_id=p_tenant and c.status in ('active','trial') and (c.ended_at is null or c.ended_at>now())
    and lower(trim(p.code))='custom' and c.metadata->'sales_modes'->'retail_wholesale'='true'::jsonb
    and not exists(select 1 from unnest(array['takeaway','home','dine_in','buffet_table','delivery','optical_retail','recycling']) k
    where c.metadata->'sales_modes'->k='true'::jsonb)) then raise exception 'RW_REQUIRED'; end if;
  select * into prior from public.rw_warehouse_commands where tenant_id=p_tenant and request_id=p_request;
  if found then
    if prior.actor_id<>p_actor or prior.payload<>payload then raise exception 'REQUEST_CONFLICT'; end if;
    return prior.result;
  end if;
  if h.status<>'approved' or h.approved_by is null or h.approved_at is null
    then raise exception 'APPROVAL_REQUIRED'; end if;
  if not exists(select 1 from public.branches where tenant_id=p_tenant and id=h.destination_branch_id and is_active)
    or not exists(select 1 from public.rw_warehouses where tenant_id=p_tenant and id=h.warehouse_id and active)
    then raise exception 'INVALID_LOCATION'; end if;
  if not exists(select 1 from public.rw_warehouse_transfer_lines where tenant_id=p_tenant and transfer_id=p_transfer)
    then raise exception 'EMPTY_TRANSFER'; end if;
  insert into public.rw_warehouse_commands(tenant_id,request_id,actor_id,payload,result)
    values(p_tenant,p_request,p_actor,payload,response);
  for l in select * from public.rw_warehouse_transfer_lines where tenant_id=p_tenant and transfer_id=p_transfer order by sku for update loop
    if l.received<>0 or l.received_minor<>0 or l.dispatched_minor<>0 then raise exception 'INVALID_LINE_STATE'; end if;
    if not exists(select 1 from public.products p join public.recipes r on r.product_id=p.id
      join public.ingredients i on i.id=r.ingredient_id
      where p.id=l.destination_product_id and i.id=l.destination_ingredient_id
      and p.tenant_id=p_tenant and r.tenant_id=p_tenant and i.tenant_id=p_tenant
      and p.branch_id=h.destination_branch_id and r.branch_id=h.destination_branch_id and i.branch_id=h.destination_branch_id
      and p.sku=l.sku and p.is_active and p.deleted_at is null and p.stock_deduction_mode='recipe_deduction'
      and i.base_unit='piece' and i.name like 'STOCK:%' and r.quantity_per_item=1 and not r.applies_when_takeaway_only)
      or (select count(*) from public.recipes where product_id=l.destination_product_id)<>1
      or (select count(*) from public.recipes where ingredient_id=l.destination_ingredient_id)<>1
      then raise exception 'INVALID_DESTINATION_MAPPING'; end if;
    select * into bal from public.rw_warehouse_balances where tenant_id=p_tenant and warehouse_id=h.warehouse_id and sku=l.sku for update;
    if not found or bal.quantity<l.quantity then raise exception 'INSUFFICIENT_WAREHOUSE_STOCK'; end if;
    -- Moving weighted-average carrying value, preserving exact final residual.
    amount := case when bal.quantity=l.quantity then bal.carrying_minor
      else floor(bal.carrying_minor::numeric*l.quantity/bal.quantity)::bigint end;
    update public.rw_warehouse_balances set quantity=quantity-l.quantity,carrying_minor=carrying_minor-amount
      where tenant_id=p_tenant and warehouse_id=h.warehouse_id and sku=l.sku;
    update public.rw_warehouse_transfer_lines set dispatched_minor=amount
      where tenant_id=p_tenant and transfer_id=p_transfer and sku=l.sku;
    insert into public.rw_warehouse_ledger(tenant_id,request_id,warehouse_id,sku,transfer_id,event,
      warehouse_delta,transit_delta,branch_delta,warehouse_value_delta,transit_value_delta,branch_value_delta)
      values(p_tenant,p_request,h.warehouse_id,l.sku,p_transfer,'dispatch',-l.quantity,l.quantity,0,-amount,amount,0);
  end loop;
  update public.rw_warehouse_transfers set status='in_transit' where tenant_id=p_tenant and id=p_transfer;
  return response;
end $$;
revoke all on function public.rw_dispatch_candidate(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.rw_dispatch_candidate(uuid,uuid,uuid,uuid) to service_role;
commit;
