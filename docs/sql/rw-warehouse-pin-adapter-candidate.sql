-- UAT-only adapter; candidate SQL, not a production migration.
-- Caller must authenticate actor and verify PIN with existing server-side validator.
begin;
create function public.rw_apply_transfer_pin_candidate(
 p_tenant uuid,p_transfer uuid,p_actor uuid,p_request uuid,p_approver uuid,p_action public.rw_transfer_approval_action
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
 h public.rw_warehouse_transfers%rowtype;
 prior public.rw_warehouse_commands%rowtype;
 snap jsonb;
 approval_id_value uuid;
begin
 if p_tenant is null or p_transfer is null or p_actor is null or p_request is null or p_approver is null or p_action is null then
   raise exception 'INVALID_COMMAND'; end if;
 if not exists(select 1 from public.user_branch_roles where tenant_id=p_tenant and user_id=p_actor and role='owner')
  or not exists(select 1 from public.user_branch_roles where tenant_id=p_tenant and user_id=p_approver and role='owner')
  then raise exception 'FORBIDDEN_WAREHOUSE'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_request::text,0));
 select * into prior from public.rw_warehouse_commands where tenant_id=p_tenant and request_id=p_request;
 if found then
  if prior.actor_id<>p_actor or (prior.payload->>'operation') is distinct from p_action::text
     or (prior.payload->>'transfer_id') is distinct from p_transfer::text then raise exception 'REQUEST_CONFLICT'; end if;
  -- Reuse original approval, not a newly minted token. The decision RPC rechecks entitlement.
  return public.rw_transfer_decision_candidate(p_tenant,p_transfer,p_actor,p_request,
    (prior.payload->>'approval_id')::uuid,p_action);
 end if;
 select * into h from public.rw_warehouse_transfers where tenant_id=p_tenant and id=p_transfer for update;
 if not found then raise exception 'TRANSFER_NOT_FOUND'; end if;
 perform 1 from public.rw_warehouse_transfer_lines where tenant_id=p_tenant and transfer_id=p_transfer order by sku for update;
 if not found then raise exception 'EMPTY_TRANSFER'; end if;
 select jsonb_build_object('warehouse_id',h.warehouse_id,'destination_branch_id',h.destination_branch_id,'status',h.status,
 'lines',jsonb_agg(jsonb_build_object('sku',l.sku,'product',l.destination_product_id,'ingredient',l.destination_ingredient_id,'quantity',l.quantity) order by l.sku))
 into snap from public.rw_warehouse_transfer_lines l where l.tenant_id=p_tenant and l.transfer_id=p_transfer;
 insert into public.rw_transfer_approvals(tenant_id,transfer_id,action,requester,approver,request_id,transfer_snapshot,expires_at)
 values(p_tenant,p_transfer,p_action,p_actor,p_approver,p_request,snap,clock_timestamp()+interval '5 minutes') returning id into approval_id_value;
 return public.rw_transfer_decision_candidate(p_tenant,p_transfer,p_actor,p_request,approval_id_value,p_action);
end $$;
revoke all on function public.rw_apply_transfer_pin_candidate(uuid,uuid,uuid,uuid,uuid,public.rw_transfer_approval_action) from public,anon,authenticated;
grant execute on function public.rw_apply_transfer_pin_candidate(uuid,uuid,uuid,uuid,uuid,public.rw_transfer_approval_action) to service_role;
create function public.rw_adjust_branch_with_pin_candidate(
 p_tenant uuid,p_branch uuid,p_product uuid,p_actor uuid,p_request uuid,p_approver uuid,p_delta integer,p_reason text
) returns uuid language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
 prior public.stock_movements%rowtype;
 ingredient_id_value uuid;
 approval_id_value uuid:=gen_random_uuid();
begin
 if p_tenant is null or p_branch is null or p_product is null or p_actor is null or p_request is null or p_approver is null
   or p_delta is null or p_delta=0 or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
   raise exception 'INVALID_ADJUSTMENT'; end if;
 if not exists(select 1 from public.user_branch_roles where tenant_id=p_tenant and branch_id=p_branch and user_id=p_actor and role in ('owner','manager'))
   or not exists(select 1 from public.user_branch_roles where tenant_id=p_tenant and branch_id=p_branch and user_id=p_approver and role in ('owner','manager'))
   then raise exception 'FORBIDDEN_BRANCH'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text||':'||p_branch::text||':rw-adjust:'||p_request::text,0));
 select * into prior from public.stock_movements where tenant_id=p_tenant and branch_id=p_branch and request_id='rw-adjust:'||p_request::text;
 if found then
   return public.rw_adjust_branch_stock_candidate(p_tenant,p_branch,p_product,prior.ingredient_id,p_actor,prior.approval_id,p_request,p_delta,p_reason);
 end if;
 perform 1 from public.products where id=p_product and tenant_id=p_tenant and branch_id=p_branch
  and is_active and deleted_at is null and stock_deduction_mode='recipe_deduction' for update;
 if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
 if (select count(*) from public.recipes where product_id=p_product)<>1 then raise exception 'AMBIGUOUS_STOCK_MAPPING'; end if;
 select r.ingredient_id into ingredient_id_value from public.recipes r join public.ingredients i on i.id=r.ingredient_id
  where r.product_id=p_product and r.tenant_id=p_tenant and r.branch_id=p_branch
  and i.tenant_id=p_tenant and i.branch_id=p_branch and i.base_unit='piece' and i.name like 'STOCK:%'
  and r.quantity_per_item=1 and not r.applies_when_takeaway_only for update of i;
 if not found then raise exception 'AMBIGUOUS_STOCK_MAPPING'; end if;
 insert into public.manager_pin_approvals(id,tenant_id,branch_id,requested_by,approved_by,action,target_table,target_id,note,expires_at)
 values(approval_id_value,p_tenant,p_branch,p_actor,p_approver,'stock_adjustment','ingredients',ingredient_id_value,
  jsonb_build_object('request_id',p_request,'product_id',p_product,'delta',p_delta,'reason',btrim(p_reason))::text,clock_timestamp()+interval '5 minutes');
 return public.rw_adjust_branch_stock_candidate(p_tenant,p_branch,p_product,ingredient_id_value,p_actor,approval_id_value,p_request,p_delta,p_reason);
end $$;
revoke all on function public.rw_adjust_branch_with_pin_candidate(uuid,uuid,uuid,uuid,uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.rw_adjust_branch_with_pin_candidate(uuid,uuid,uuid,uuid,uuid,uuid,integer,text) to service_role;
commit;
