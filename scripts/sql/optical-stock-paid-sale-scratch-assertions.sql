-- PostgreSQL17 scratch only: simulate external payment service to verify stock and payment atomicity.
-- This verifies invariant and rollback behavior, not real bank payment gateways.
\set ON_ERROR_STOP on
update public.tenant_subscription_contracts
set metadata=jsonb_set(metadata,'{pos_currency_code}','"LAK"',true)
where tenant_id='00000000-0000-4000-8000-000000000001';
alter table public.order_items add column quantity numeric not null default 1;
create table public.payments(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,branch_id uuid not null,order_id uuid not null,
 request_group_id text not null,amount numeric not null
);
create or replace function app.complete_pos_payment_tx(
 p_tenant_id uuid,p_branch_id uuid,p_order_id uuid,p_received_by uuid,
 p_payment_lines jsonb,p_request_group_id text default null
) returns table(payment_group_id text,total_paid numeric,order_status text,duplicate_request boolean)
language plpgsql as $mock$
declare v_amount numeric;
begin
 if exists(select 1 from public.payments p where p.tenant_id=p_tenant_id
  and p.branch_id=p_branch_id and p.order_id=p_order_id) then
   return query select min(p.request_group_id),sum(p.amount),'completed'::text,true
   from public.payments p where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id
    and p.order_id=p_order_id;return;
 end if;
 select sum((x->>'amount')::numeric) into v_amount
 from jsonb_array_elements(p_payment_lines) as x;
 if v_amount<>1000 then raise exception 'SYNTHETIC_AMOUNT_MISMATCH';end if;
 insert into public.payments(tenant_id,branch_id,order_id,request_group_id,amount)
 values(p_tenant_id,p_branch_id,p_order_id,p_request_group_id,v_amount);
 update public.orders o set status='completed'
 where o.id=p_order_id and o.tenant_id=p_tenant_id and o.branch_id=p_branch_id;
 return query select p_request_group_id,v_amount,'completed'::text,false;
end;$mock$;
\ir ../../supabase/migrations/20261019223000_optical_pos_paid_sale_atomic_deduction.sql
insert into public.orders(id,tenant_id,branch_id,status) values
 ('00000000-0000-4000-8000-000000007001','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','queued'),
 ('00000000-0000-4000-8000-000000007002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','queued');
insert into public.order_items(tenant_id,branch_id,product_id,order_id,quantity) values
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000007001',1),
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000007002',1);
select set_config('request.jwt.claim.role','service_role',false);
do $$
declare v_paid numeric;v_replay boolean;v_prior integer;
begin
 select p.total_paid,p.duplicate_request into v_paid,v_replay
 from public.optical_complete_pos_payment_tx(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000007001',
 '00000000-0000-4000-8000-000000000101',
 '[{"method":"cash","amount":1000}]'::jsonb,
 'qa-payment-group-001') p;
 if v_paid<>1000 or v_replay is distinct from false then raise exception 'initial payment failed';end if;
 select on_hand into v_prior from public.optical_stock_bins limit 1;
 if v_prior<>2 or (select count(*) from public.optical_pos_sale_stock_ledger)<>1
 then raise exception 'payment not coupled to inventory decrement';end if;
 select p.duplicate_request into v_replay
 from public.optical_complete_pos_payment_tx(
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000007001',
 '00000000-0000-4000-8000-000000000101',
 '[{"method":"cash","amount":1000}]'::jsonb,
 'qa-payment-group-001') p;
 if v_replay is distinct from true or
  (select on_hand from public.optical_stock_bins limit 1)<>2 or
  (select count(*) from public.optical_pos_sale_stock_ledger)<>1 or
  (select count(*) from public.payments)<>1
 then raise exception 'duplicate optical payment moved money or stock';end if;
 -- Only reserved units remain: second sale must not charge the customer.
 begin
  perform * from public.optical_complete_pos_payment_tx(
   '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000007002',
   '00000000-0000-4000-8000-000000000101',
   '[{"method":"cash","amount":1000}]'::jsonb,
   'qa-payment-group-002');
  raise exception 'reserved units oversold';
 exception when others then
  if sqlerrm='reserved units oversold' then raise;end if;
  if position('OPTICAL_PAYMENT_INSUFFICIENT_AVAILABLE_STOCK' in sqlerrm)=0 then raise;end if;
 end;
 if (select count(*) from public.payments)<>1 then raise exception 'unsafe payment charged';end if;
 begin
  perform * from public.complete_pos_payment_tx(
   '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000007002',
   '00000000-0000-4000-8000-000000000101',
   '[{"method":"cash","amount":1000}]'::jsonb,
   'qa-payment-group-003');
  raise exception 'legacy RPC bypass was allowed';
 exception when others then
  if sqlerrm='legacy RPC bypass was allowed' then raise;end if;
  if position('OPTICAL_USE_ATOMIC_PAYMENT_RPC' in sqlerrm)=0 then raise;end if;
 end;
 if (select count(*) from public.payments)<>1 then raise exception 'generic RPC inserted optical payment';end if;
 if (select count(*) from public.audit_logs where action='optical_pos_sale_stock_deducted')<>1
 then raise exception 'deduction missing audit';end if;
end $$;
select 'optical_sale_payment_atomic_scratch_passed' as result;
