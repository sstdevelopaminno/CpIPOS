-- Verify owner/manager PIN inside the same audited database transaction.
-- Never delete paid ledger rows. A paid work order needs a separate refund process
-- before it can be cancelled; PIN is not a substitute for a refund.
create or replace function public.optical_manage_work_order_pin_v2(
 p_tenant_id uuid,p_branch_id uuid,p_work_order_id uuid,p_actor uuid,
 p_action text,p_request_id uuid,p_manager_pin text,p_note text default null,
 p_due_at timestamptz default null
) returns jsonb language plpgsql security definer
set search_path to pg_catalog,public,app,extensions,pg_temp
as $fn$
declare v_order public.optical_work_orders%rowtype;v_approver uuid;
        v_actor_role text;v_status text;
begin
 if p_tenant_id is null or p_branch_id is null or p_work_order_id is null or
    p_actor is null or p_request_id is null or p_action not in('update','cancel')
 then raise exception 'OPTICAL_PIN_ACTION_INVALID' using errcode='22023';end if;
 if auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_actor
 then raise exception 'OPTICAL_PIN_ACTOR_DENIED' using errcode='42501';end if;
 select r.role::text into v_actor_role from public.user_branch_roles r
   join public.users_profiles u on u.id=r.user_id
 where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id and r.user_id=p_actor
   and r.role::text in ('owner','manager','staff') and u.is_active and u.archived_at is null
 limit 1;
 if v_actor_role is null then raise exception 'OPTICAL_PIN_BRANCH_DENIED' using errcode='42501';end if;
 if not app.custom_optical_finance_read_enabled(p_tenant_id)
 then raise exception 'OPTICAL_PIN_FINANCE_DISABLED' using errcode='42501';end if;
 if length(btrim(coalesce(p_manager_pin,'')))<4 or length(p_manager_pin)>32
 then raise exception 'OPTICAL_MANAGER_PIN_REQUIRED' using errcode='42501';end if;
 select r.user_id into v_approver from public.user_branch_roles r
   join public.users_profiles u on u.id=r.user_id
 where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id
   and r.role::text in ('owner','manager') and u.is_active and u.archived_at is null
   and u.pin_hash is not null
   and extensions.crypt(btrim(p_manager_pin),u.pin_hash)=u.pin_hash
 order by case when r.role::text='owner' then 0 else 1 end
 limit 1;
 if v_approver is null then raise exception 'OPTICAL_MANAGER_PIN_INVALID' using errcode='42501';end if;
 select * into v_order from public.optical_work_orders
 where id=p_work_order_id and tenant_id=p_tenant_id and branch_id=p_branch_id for update;
 if not found then raise exception 'OPTICAL_ORDER_NOT_FOUND' using errcode='P0002';end if;
 if p_action='update' then
  if v_order.status in ('collected','cancelled') then
    raise exception 'OPTICAL_ORDER_CLOSED' using errcode='22023';
  end if;
  if length(coalesce(p_note,''))>1000 then raise exception 'OPTICAL_NOTE_TOO_LONG';end if;
  if p_due_at is not null and (p_due_at<now()-interval '1 day' or p_due_at>now()+interval '5 years')
  then raise exception 'OPTICAL_PICKUP_DATE_INVALID' using errcode='22023';end if;
  update public.optical_work_orders set note=nullif(trim(coalesce(p_note,'')),''),
   due_at=coalesce(p_due_at,v_order.due_at),updated_at=now()
   where id=v_order.id and tenant_id=p_tenant_id and branch_id=p_branch_id;
  v_status:=v_order.status;
 else
  if v_order.paid_total<>0 then
    raise exception 'OPTICAL_REFUND_REQUIRED_BEFORE_CANCELLATION' using errcode='22023';
  end if;
  if v_order.status in('collected','cancelled') then raise exception 'OPTICAL_ORDER_ALREADY_TERMINAL' using errcode='22023';end if;
  perform public.optical_transition_work_order_tx(
   p_tenant_id,p_branch_id,p_work_order_id,v_approver,'cancelled',p_request_id);
  v_status:='cancelled';
 end if;
 insert into public.audit_logs(tenant_id,branch_id,actor_user_id,actor_role,action,target_table,target_id,metadata)
 values(p_tenant_id,p_branch_id,p_actor,v_actor_role,
  case when p_action='cancel' then 'optical_order_pin_cancelled' else 'optical_order_pin_updated' end,
  'optical_work_orders',p_work_order_id,
  jsonb_build_object('approved_by',v_approver,'request_id',p_request_id,'paid_total',v_order.paid_total));
 return jsonb_build_object('id',p_work_order_id,'action',p_action,'status',v_status,'approved_by',v_approver);
end;
$fn$;
revoke all on function public.optical_manage_work_order_pin_v2(uuid,uuid,uuid,uuid,text,uuid,text,text,timestamptz) from public,anon;
grant execute on function public.optical_manage_work_order_pin_v2(uuid,uuid,uuid,uuid,text,uuid,text,text,timestamptz) to authenticated,service_role;
-- Legacy no-PIN route should not be callable directly by CRM clients.
revoke execute on function public.optical_manage_work_order_v1(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz) from authenticated;
