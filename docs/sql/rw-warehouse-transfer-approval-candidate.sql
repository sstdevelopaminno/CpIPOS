-- Candidate only. Dedicated warehouse approval issuance must be implemented before release.
-- The existing stock_adjustment action must not be reinterpreted as a transfer approval.
begin;
create type public.rw_transfer_approval_action as enum ('approve_transfer','cancel_transfer');
create table public.rw_transfer_approvals (
 tenant_id uuid not null, id uuid not null default gen_random_uuid(), transfer_id uuid not null,
 action public.rw_transfer_approval_action not null, requester uuid not null, approver uuid not null,
 request_id uuid not null, transfer_snapshot jsonb not null,
 expires_at timestamptz not null, consumed_at timestamptz,
 primary key(tenant_id,id), unique(tenant_id,request_id),
 foreign key(tenant_id,transfer_id) references public.rw_warehouse_transfers(tenant_id,id)
);
alter table public.rw_transfer_approvals enable row level security;
revoke all on public.rw_transfer_approvals from public,anon,authenticated,service_role;
grant select,insert,update on public.rw_transfer_approvals to service_role;
create function public.rw_transfer_decision_candidate(p_tenant uuid,p_transfer uuid,p_actor uuid,p_request uuid,p_approval uuid,p_action public.rw_transfer_approval_action)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
 h public.rw_warehouse_transfers%rowtype;
 prior public.rw_warehouse_commands%rowtype;
 snapshot jsonb;
 approver_id uuid;
 payload jsonb := jsonb_build_object('operation',p_action,'transfer_id',p_transfer,'approval_id',p_approval);
 response jsonb;
 next_status text;
begin
 if p_tenant is null or p_transfer is null or p_actor is null or p_request is null or p_approval is null or p_action is null
   then raise exception 'INVALID_COMMAND'; end if;
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
 select * into h from public.rw_warehouse_transfers where tenant_id=p_tenant and id=p_transfer for update;
 if not found then raise exception 'TRANSFER_NOT_FOUND'; end if;
 select * into prior from public.rw_warehouse_commands where tenant_id=p_tenant and request_id=p_request;
 if found then
   if prior.actor_id<>p_actor or prior.payload<>payload then raise exception 'REQUEST_CONFLICT'; end if;
   return prior.result;
 end if;
 if (p_action='approve_transfer' and h.status<>'draft') or
    (p_action='cancel_transfer' and h.status not in ('draft','approved'))
    then raise exception 'INVALID_TRANSITION'; end if;
 perform 1 from public.rw_warehouse_transfer_lines where tenant_id=p_tenant and transfer_id=p_transfer order by sku for update;
 if not found then raise exception 'EMPTY_TRANSFER'; end if;
 select jsonb_build_object('warehouse_id',h.warehouse_id,'destination_branch_id',h.destination_branch_id,'status',h.status,
  'lines',jsonb_agg(jsonb_build_object('sku',l.sku,'product',l.destination_product_id,'ingredient',l.destination_ingredient_id,'quantity',l.quantity) order by l.sku))
 into snapshot from public.rw_warehouse_transfer_lines l where l.tenant_id=p_tenant and l.transfer_id=p_transfer;
 update public.rw_transfer_approvals a set consumed_at=clock_timestamp()
  where a.tenant_id=p_tenant and a.id=p_approval and a.transfer_id=p_transfer and a.action=p_action
   and a.requester=p_actor and a.request_id=p_request and a.transfer_snapshot=snapshot
   and a.expires_at>clock_timestamp() and a.consumed_at is null
   and exists(select 1 from public.user_branch_roles where tenant_id=p_tenant and user_id=a.approver and role='owner')
  returning a.approver into approver_id;
 if not found then raise exception 'INVALID_APPROVAL'; end if;
 next_status:=case when p_action='approve_transfer' then 'approved' else 'cancelled' end;
 update public.rw_warehouse_transfers set status=next_status,
  approved_by=case when next_status='approved' then approver_id else approved_by end,
  approved_at=case when next_status='approved' then clock_timestamp() else approved_at end
  where tenant_id=p_tenant and id=p_transfer;
 response:=jsonb_build_object('status',next_status,'transfer_id',p_transfer);
 insert into public.rw_warehouse_commands(tenant_id,request_id,actor_id,payload,result)
  values(p_tenant,p_request,p_actor,payload,response);
 return response;
end $$;
revoke all on function public.rw_transfer_decision_candidate(uuid,uuid,uuid,uuid,uuid,public.rw_transfer_approval_action) from public,anon,authenticated;
grant execute on function public.rw_transfer_decision_candidate(uuid,uuid,uuid,uuid,uuid,public.rw_transfer_approval_action) to service_role;
commit;
