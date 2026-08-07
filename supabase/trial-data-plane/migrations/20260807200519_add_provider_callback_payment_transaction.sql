create or replace function app.complete_pos_provider_payment_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_received_by uuid,
  p_amount numeric,
  p_reference_no text,
  p_request_group_id text,
  p_provider text
)
returns table(payment_group_id text,total_paid numeric,order_status text,duplicate_request boolean)
language plpgsql
security definer
set search_path=pg_catalog,public,app,extensions
as $$
declare
  v_total_due numeric(12,2);
  v_shift_id uuid;
  v_amount numeric(12,2);
  v_request_id text;
begin
  if p_provider <> 'inet_nops' then raise exception 'UNSUPPORTED_PAYMENT_PROVIDER'; end if;
  if not exists(select 1 from public.trial_branch_scopes b where b.tenant_id=p_tenant_id and b.branch_id=p_branch_id and b.is_active=true) then
    raise exception 'TRIAL_BRANCH_SCOPE_INACTIVE';
  end if;
  v_request_id := nullif(trim(p_request_group_id),'');
  if v_request_id is null then raise exception 'PAYMENT_REQUEST_GROUP_REQUIRED'; end if;
  v_amount := round(coalesce(p_amount,0),2);
  if v_amount <= 0 then raise exception 'INVALID_PAYMENT_AMOUNT'; end if;

  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text||':'||p_branch_id::text||':'||p_order_id::text||':'||v_request_id));

  if exists(select 1 from public.payments p where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id and p.order_id=p_order_id and p.request_group_id=v_request_id) then
    return query select v_request_id,coalesce((select sum(p.amount) from public.payments p where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id and p.order_id=p_order_id and p.request_group_id=v_request_id),0)::numeric(12,2),'completed'::text,true;
    return;
  end if;

  select o.total_amount,o.shift_id into v_total_due,v_shift_id
  from public.orders o
  where o.id=p_order_id and o.tenant_id=p_tenant_id and o.branch_id=p_branch_id
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if abs(v_amount-round(v_total_due,2)) > 0.01 then raise exception 'PAYMENT_TOTAL_MISMATCH'; end if;

  insert into public.payments(tenant_id,branch_id,order_id,method,amount,reference_no,received_by,request_group_id,shift_id,pos_session_id,status,metadata)
  values(p_tenant_id,p_branch_id,p_order_id,'bank_transfer',v_amount,nullif(trim(p_reference_no),''),p_received_by,v_request_id,v_shift_id,null,'paid',jsonb_build_object('provider',p_provider,'source','provider_callback'));

  update public.orders o
  set status='completed',paid_total=v_amount,payment_completed_at=now(),payment_completed_by=p_received_by
  where o.id=p_order_id and o.tenant_id=p_tenant_id and o.branch_id=p_branch_id and o.status<>'cancelled';
  if not found then raise exception 'ORDER_CANCELLED_OR_NOT_FOUND'; end if;

  return query select v_request_id,v_amount,'completed'::text,false;
end;
$$;

create or replace function public.complete_pos_provider_payment_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_received_by uuid,
  p_amount numeric,
  p_reference_no text,
  p_request_group_id text,
  p_provider text
)
returns table(payment_group_id text,total_paid numeric,order_status text,duplicate_request boolean)
language sql
security definer
set search_path=pg_catalog,public,app,extensions
as $$ select * from app.complete_pos_provider_payment_tx(p_tenant_id,p_branch_id,p_order_id,p_received_by,p_amount,p_reference_no,p_request_group_id,p_provider); $$;

revoke execute on function app.complete_pos_provider_payment_tx(uuid,uuid,uuid,uuid,numeric,text,text,text) from public,anon,authenticated;
revoke execute on function public.complete_pos_provider_payment_tx(uuid,uuid,uuid,uuid,numeric,text,text,text) from public,anon,authenticated;
grant execute on function app.complete_pos_provider_payment_tx(uuid,uuid,uuid,uuid,numeric,text,text,text) to service_role;
grant execute on function public.complete_pos_provider_payment_tx(uuid,uuid,uuid,uuid,numeric,text,text,text) to service_role;
