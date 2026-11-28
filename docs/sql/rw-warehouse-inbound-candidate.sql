-- Candidate only. Inbound document/finance integration and PIN policy not yet wired.
begin;
create function public.rw_inbound_candidate(
 p_tenant uuid,p_warehouse uuid,p_actor uuid,p_request uuid,p_sku text,p_quantity bigint,p_total_minor bigint,p_source_document text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
 prior public.rw_warehouse_commands%rowtype;
 command_payload jsonb := jsonb_build_object('operation','warehouse_receipt','warehouse_id',p_warehouse,
 'sku',p_sku,'quantity',p_quantity,'total_minor',p_total_minor,'source_document',p_source_document);
 response jsonb;
begin
 if p_tenant is null or p_warehouse is null or p_actor is null or p_request is null or p_sku is null
  or p_sku<>btrim(p_sku) or length(p_sku) not between 1 and 40 or p_quantity is null or p_quantity<=0
  or p_total_minor is null or p_total_minor<0 or p_source_document is null
  or length(btrim(p_source_document)) not between 1 and 120 then raise exception 'INVALID_RECEIPT'; end if;
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
  if prior.actor_id<>p_actor or prior.payload<>command_payload then raise exception 'REQUEST_CONFLICT'; end if;
  return prior.result;
 end if;
 perform 1 from public.rw_warehouses where tenant_id=p_tenant and id=p_warehouse and active for share;
 if not found then raise exception 'WAREHOUSE_NOT_FOUND'; end if;
 -- Only a previously registered SKU; no implicit product creation.
 update public.rw_warehouse_balances set quantity=quantity+p_quantity,carrying_minor=carrying_minor+p_total_minor
  where tenant_id=p_tenant and warehouse_id=p_warehouse and sku=p_sku
  returning jsonb_build_object('warehouse_id',warehouse_id,'sku',sku,'quantity',quantity,'carrying_minor',carrying_minor) into response;
 if not found then raise exception 'SKU_NOT_REGISTERED'; end if;
 insert into public.rw_warehouse_commands(tenant_id,request_id,actor_id,payload,result)
  values(p_tenant,p_request,p_actor,command_payload,response);
 insert into public.rw_warehouse_ledger(tenant_id,request_id,warehouse_id,sku,event,
  warehouse_delta,transit_delta,branch_delta,warehouse_value_delta,transit_value_delta,branch_value_delta)
  values(p_tenant,p_request,p_warehouse,p_sku,'warehouse_receipt',p_quantity,0,0,p_total_minor,0,0);
 return response;
end $$;
revoke all on function public.rw_inbound_candidate(uuid,uuid,uuid,uuid,text,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.rw_inbound_candidate(uuid,uuid,uuid,uuid,text,bigint,bigint,text) to service_role;
commit;
