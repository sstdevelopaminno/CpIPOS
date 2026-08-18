-- Trial data-plane parity for table-order concurrency hardening.
-- The order row is locked before evaluating whether a fresh request key may pay it.

create or replace function app.complete_pos_payment_tx(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_order_id uuid,
  p_received_by uuid,
  p_payment_lines jsonb,
  p_request_group_id text default null
)
returns table(
  payment_group_id text,
  total_paid numeric,
  order_status text,
  duplicate_request boolean
)
language plpgsql
security definer
set search_path to pg_catalog, public, app, extensions
set lock_timeout to '5s'
as $$
declare
  v_total_due numeric(12,2);
  v_total_paid numeric(12,2) := 0;
  v_shift_id uuid;
  v_session_id uuid;
  v_order_status text;
  v_line jsonb;
  v_method public.payment_method;
  v_amount numeric(12,2);
  v_reference text;
begin
  if p_payment_lines is null or jsonb_typeof(p_payment_lines)<>'array' or jsonb_array_length(p_payment_lines)=0 then
    raise exception 'PAYMENT_LINES_REQUIRED';
  end if;

  if nullif(trim(p_request_group_id),'') is not null then
    perform pg_advisory_xact_lock(hashtext(p_tenant_id::text||':'||p_branch_id::text||':'||p_order_id::text||':'||trim(p_request_group_id)));
    if exists(
      select 1
      from public.payments p
      where p.tenant_id=p_tenant_id
        and p.branch_id=p_branch_id
        and p.order_id=p_order_id
        and p.request_group_id=trim(p_request_group_id)
    ) then
      select coalesce(sum(p.amount),0)::numeric(12,2)
        into v_total_paid
      from public.payments p
      where p.tenant_id=p_tenant_id
        and p.branch_id=p_branch_id
        and p.order_id=p_order_id
        and p.request_group_id=trim(p_request_group_id);
      return query select trim(p_request_group_id),v_total_paid,'completed'::text,true;
      return;
    end if;
  end if;

  select o.total_amount,o.shift_id,o.status::text
    into v_total_due,v_shift_id,v_order_status
  from public.orders o
  where o.id=p_order_id and o.tenant_id=p_tenant_id and o.branch_id=p_branch_id
  for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if lower(coalesce(v_order_status,'')) in ('completed','paid','closed','cleared') then
    raise exception 'ORDER_ALREADY_PAID';
  end if;
  if lower(coalesce(v_order_status,''))='cancelled' then
    raise exception 'ORDER_CANCELLED_OR_NOT_FOUND';
  end if;

  v_session_id := app.require_trial_runtime(p_tenant_id,p_branch_id,v_shift_id,p_received_by);

  for v_line in select value from jsonb_array_elements(p_payment_lines)
  loop
    v_method := (v_line->>'method')::public.payment_method;
    v_amount := round(coalesce((v_line->>'amount')::numeric,0),2);
    v_reference := nullif(v_line->>'reference_no','');
    if v_amount <= 0 then raise exception 'INVALID_PAYMENT_AMOUNT'; end if;
    v_total_paid := v_total_paid + v_amount;
    insert into public.payments(
      tenant_id,branch_id,order_id,method,amount,reference_no,received_by,request_group_id,shift_id,pos_session_id,status
    )
    values(
      p_tenant_id,p_branch_id,p_order_id,v_method,v_amount,v_reference,p_received_by,
      nullif(trim(p_request_group_id),''),v_shift_id,v_session_id,'paid'
    );
  end loop;

  v_total_paid := round(v_total_paid,2);
  if abs(v_total_paid-v_total_due)>0.01 then raise exception 'PAYMENT_TOTAL_MISMATCH'; end if;

  update public.orders o
  set status='completed',paid_total=v_total_paid,payment_completed_at=now(),payment_completed_by=p_received_by
  where o.id=p_order_id and o.tenant_id=p_tenant_id and o.branch_id=p_branch_id and o.status<>'cancelled';
  if not found then raise exception 'ORDER_CANCELLED_OR_NOT_FOUND'; end if;

  return query select coalesce(nullif(trim(p_request_group_id),''),''),v_total_paid,'completed'::text,false;
end;
$$;

revoke all on function app.complete_pos_payment_tx(uuid,uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;
grant execute on function app.complete_pos_payment_tx(uuid,uuid,uuid,uuid,jsonb,text) to service_role;
