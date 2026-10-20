-- Atomic date-aware Optical deposit: always attach confirmed pickup date to the SAME
-- transaction that reserves items and posts the first payment. Existing RPC stays compatible.
create or replace function public.optical_open_with_deposit_due_v1(
 p_tenant_id uuid,p_branch_id uuid,p_actor uuid,p_shift_id uuid,p_customer_id uuid,
 p_seller_id uuid,p_items jsonb,p_discount_lak numeric,p_order_request_id uuid,
 p_payment_request_id uuid,p_amount_lak numeric,p_method text,p_transfer_reference text,
 p_verified_by uuid,p_due_date date
) returns table(work_order_id uuid,payment_id uuid,paid_total numeric,remaining_amount numeric,duplicate_request boolean)
language plpgsql security invoker
set search_path to pg_catalog,public,app
as $fn$
declare v record;v_due timestamptz;v_original_due timestamptz;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
 then raise exception 'OPTICAL_DEPOSIT_SERVICE_ROLE_REQUIRED' using errcode='42501';end if;
 if p_due_date is null or p_due_date<(now() at time zone 'Asia/Bangkok')::date
    or p_due_date>(now() at time zone 'Asia/Bangkok')::date+1825
 then raise exception 'OPTICAL_DUE_DATE_INVALID' using errcode='22023';end if;
 v_due:=p_due_date::timestamp at time zone 'Asia/Bangkok';
 -- The existing atomic financial transaction and its stock/idempotency locks
 -- are the single source of truth; failure to persist due date rolls back all.
 select * into strict v from public.optical_open_with_deposit_tx(
  p_tenant_id,p_branch_id,p_actor,p_shift_id,p_customer_id,p_seller_id,p_items,
  p_discount_lak,p_order_request_id,p_payment_request_id,p_amount_lak,p_method,
  p_transfer_reference,p_verified_by
 );
 select w.due_at into v_original_due from public.optical_work_orders w
 where w.id=v.work_order_id and w.tenant_id=p_tenant_id and w.branch_id=p_branch_id for update;
 if v.duplicate_request then
   if v_original_due is distinct from v_due then
      raise exception 'OPTICAL_DUE_DATE_IDEMPOTENCY_CONFLICT' using errcode='22023';
   end if;
 else
   update public.optical_work_orders w set due_at=v_due,updated_at=now()
   where w.id=v.work_order_id and w.tenant_id=p_tenant_id and w.branch_id=p_branch_id;
   if not found then raise exception 'OPTICAL_DUE_DATE_ORDER_NOT_FOUND';end if;
 end if;
 return query select v.work_order_id::uuid,v.payment_id::uuid,
   v.paid_total::numeric,v.remaining_amount::numeric,v.duplicate_request::boolean;
end;$fn$;
revoke all on function public.optical_open_with_deposit_due_v1(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,uuid,uuid,numeric,text,text,uuid,date) from public,anon,authenticated;
grant execute on function public.optical_open_with_deposit_due_v1(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,uuid,uuid,numeric,text,text,uuid,date) to service_role;
