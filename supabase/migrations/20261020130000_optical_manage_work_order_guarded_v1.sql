-- CUSTOM Optical: safe work-order detail actions shared by POS and CRM.
-- Adds only an authenticated management RPC; never modifies financial totals or ledger.
create or replace function public.optical_manage_work_order_v1(
 p_tenant_id uuid,p_branch_id uuid,p_work_order_id uuid,
 p_actor uuid,p_action text,p_request_id uuid,
 p_note text default null,p_due_at timestamptz default null
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app, pg_temp
as $$
declare v public.optical_work_orders%rowtype; v_result record;
begin
 if p_tenant_id is null or p_branch_id is null or p_work_order_id is null
  or p_actor is null or p_request_id is null then
   raise exception 'OPTICAL_ORDER_SCOPE_REQUIRED' using errcode='22023';
 end if;
 -- Browser RPC must use its own Supabase Auth identity. POS server uses service_role.
 if coalesce(auth.role(),'')<>'service_role' and auth.uid() is distinct from p_actor then
   raise exception 'OPTICAL_ORDER_ACTOR_MISMATCH' using errcode='42501';
 end if;
 if not exists (
   select 1 from public.user_branch_roles r join public.users_profiles u on u.id=r.user_id
    where r.tenant_id=p_tenant_id and r.branch_id=p_branch_id
     and r.user_id=p_actor and r.role::text in('owner','manager')
     and u.is_active and u.archived_at is null
 ) then raise exception 'OPTICAL_ORDER_MANAGEMENT_DENIED' using errcode='42501'; end if;
 if not app.custom_optical_finance_read_enabled(p_tenant_id) then
   raise exception 'OPTICAL_WORK_ORDERS_NOT_APPROVED' using errcode='42501';
 end if;
 select * into v from public.optical_work_orders
  where id=p_work_order_id and tenant_id=p_tenant_id and branch_id=p_branch_id
  for update;
 if not found then raise exception 'OPTICAL_WORK_ORDER_NOT_FOUND' using errcode='P0002'; end if;
 if p_action='update' then
   if v.status<>'received' or v.paid_total<>0 then
      raise exception 'OPTICAL_ORDER_LOCKED_AFTER_PAYMENT_OR_PROGRESS' using errcode='22023';
   end if;
   if length(coalesce(p_note,''))>1000 then
      raise exception 'OPTICAL_NOTE_TOO_LONG' using errcode='22023';
   end if;
   update public.optical_work_orders set note=nullif(trim(coalesce(p_note,'')),''),
      due_at=p_due_at,updated_at=now()
    where id=v.id and tenant_id=p_tenant_id and branch_id=p_branch_id;
   return jsonb_build_object('id',v.id,'action','updated');
 elsif p_action='cancel' then
   if v.paid_total<>0 then
      raise exception 'OPTICAL_REFUND_REQUIRED_BEFORE_CANCELLATION' using errcode='22023';
   end if;
   select * into v_result from public.optical_transition_work_order_tx(
      p_tenant_id,p_branch_id,p_work_order_id,p_actor,'cancelled',p_request_id);
   return jsonb_build_object('id',v.id,'action','cancelled','status',v_result.status);
 else
   raise exception 'OPTICAL_ORDER_INVALID_ACTION' using errcode='22023';
 end if;
end;
$$;
revoke all on function public.optical_manage_work_order_v1(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz) from public,anon;
grant execute on function public.optical_manage_work_order_v1(uuid,uuid,uuid,uuid,text,uuid,text,timestamptz) to authenticated,service_role;
