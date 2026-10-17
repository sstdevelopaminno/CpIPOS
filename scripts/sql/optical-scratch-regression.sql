-- Runs only against fresh Docker PostgreSQL service in GitHub Actions.
\set ON_ERROR_STOP on
grant select on all tables in schema public to service_role;
-- Test trigger behavior as service_role (production grants are unchanged).
grant insert on public.order_items to service_role;
grant insert,update,delete on public.optical_stock_bins,public.optical_work_orders,
 public.optical_work_order_lines,public.optical_stock_reservations,
 public.optical_payment_ledger,public.optical_stock_movements,public.optical_work_order_events
 to service_role;
grant usage on schema public,app to service_role;
set role service_role;
set search_path to public,app;

insert into public.optical_stock_bins(
 tenant_id,branch_id,product_id,kind,brand,unit,currency_code,unit_price,on_hand,reserved
) values (
 '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011',
 '00000000-0000-4000-8000-000000000201','frame','Synthetic','piece','LAK',1000,2,0
);

do $tests$
declare
  t uuid:='00000000-0000-4000-8000-000000000001';
  b uuid:='00000000-0000-4000-8000-000000000011';
  actor uuid:='00000000-0000-4000-8000-000000000101';
  customer uuid:='00000000-0000-4000-8000-000000000301';
  product uuid:='00000000-0000-4000-8000-000000000201';
  shift uuid:='00000000-0000-4000-8000-000000000401';
  request uuid:='00000000-0000-4000-8000-000000000601';
  pay1 uuid:='00000000-0000-4000-8000-000000000701';
  pay2 uuid:='00000000-0000-4000-8000-000000000702';
  wid uuid; wid2 uuid;
  dupe boolean;
  amt numeric;
  balance numeric;
  payment uuid;
  current_status text;
  available int;
  rows_count int;
begin
  select c.work_order_id,c.duplicate_request into wid,dupe
  from public.optical_create_work_order_tx(
    t,b,actor,actor,customer,null,
    jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1)),
    0,request,null,null
  ) c;
  if wid is null or dupe then raise exception 'new order creation failed'; end if;

  select c.work_order_id,c.duplicate_request into wid2,dupe
  from public.optical_create_work_order_tx(
    t,b,actor,actor,customer,null,
    jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1)),
    0,request,null,null
  ) c;
  if wid2<>wid or not dupe then raise exception 'create replay not idempotent'; end if;
  select reserved from public.optical_stock_bins where product_id=product into available;
  if available<>1 then raise exception 'creation reserved more than once'; end if;

  begin
    perform public.optical_create_work_order_tx(
      t,b,actor,actor,customer,null,
      jsonb_build_array(jsonb_build_object('product_id',product,'quantity',2)),
      0,request,null,null);
    raise exception 'EXPECTED_CREATE_CONFLICT';
  exception when others then
    if SQLERRM<>'OPTICAL_CREATE_IDEMPOTENCY_CONFLICT' then
      raise exception 'unexpected create replay error: %',SQLERRM;
    end if;
  end;

  begin
    perform public.optical_create_work_order_tx(
      t,b,actor,actor,customer,null,
      jsonb_build_array(jsonb_build_object('product_id',product,'quantity',2)),
      0,'00000000-0000-4000-8000-000000000602'::uuid,null,null);
    raise exception 'EXPECTED_STOCK_DENIAL';
  exception when others then
    if SQLERRM<>'OPTICAL_INSUFFICIENT_AVAILABLE_STOCK' then
      raise exception 'unexpected insufficient stock error: %',SQLERRM;
    end if;
  end;

  select p.payment_id,p.paid_total,p.remaining_amount,p.duplicate_request
    into payment,amt,balance,dupe
  from public.optical_post_deposit_tx(t,b,wid,actor,shift,pay1,500,'cash',null,null) p;
  if dupe or amt<>500 or balance<>500 or payment is null then
    raise exception 'deposit 500/1000 failed'; end if;

  select p.payment_id,p.paid_total,p.remaining_amount,p.duplicate_request
    into payment,amt,balance,dupe
  from public.optical_post_deposit_tx(t,b,wid,actor,shift,pay1,500,'cash',null,null) p;
  if not dupe or amt<>500 or balance<>500 then raise exception 'deposit replay invalid'; end if;

  begin
    perform public.optical_post_deposit_tx(t,b,wid,actor,shift,
      '00000000-0000-4000-8000-000000000703'::uuid,501,'cash',null,null);
    raise exception 'EXPECTED_OVERPAY';
  exception when others then
    if SQLERRM<>'OPTICAL_PAYMENT_AMOUNT_INVALID' then
      raise exception 'unexpected overpay behavior: %',SQLERRM; end if;
  end;

  begin
    perform public.optical_post_deposit_tx(t,b,wid,actor,shift,
      '00000000-0000-4000-8000-000000000704'::uuid,0.5,'cash',null,null);
    raise exception 'EXPECTED_FRACTIONAL_DENIAL';
  exception when others then
    if SQLERRM<>'OPTICAL_PAYMENT_AMOUNT_INVALID' then
      raise exception 'unexpected LAK precision behavior: %',SQLERRM; end if;
  end;

  -- Complete the remaining amount with exactly one more ledger entry.
  select p.paid_total,p.remaining_amount into amt,balance
  from public.optical_post_deposit_tx(t,b,wid,actor,shift,pay2,500,'cash',null,null) p;
  if amt<>1000 or balance<>0 then raise exception 'final payment failed'; end if;

  begin
    perform public.optical_post_deposit_tx(t,b,wid,actor,shift,
      '00000000-0000-4000-8000-000000000705'::uuid,1,'cash',null,null);
    raise exception 'EXPECTED_PAID_DENIAL';
  exception when others then
    if SQLERRM<>'OPTICAL_BILL_PAID_OR_TERMINAL' then
      raise exception 'paid bill incorrectly reopened: %',SQLERRM; end if;
  end;

  select o.status into current_status from public.optical_transition_work_order_tx(
   t,b,wid,actor,'lens_ordered','00000000-0000-4000-8000-000000000801'::uuid) o;
  if current_status<>'lens_ordered' then raise exception 'lens stage invalid'; end if;
  perform public.optical_transition_work_order_tx(t,b,wid,actor,'edging',
   '00000000-0000-4000-8000-000000000802'::uuid);
  perform public.optical_transition_work_order_tx(t,b,wid,actor,'ready_for_pickup',
   '00000000-0000-4000-8000-000000000803'::uuid);
  perform public.optical_transition_work_order_tx(t,b,wid,actor,'collected',
   '00000000-0000-4000-8000-000000000804'::uuid);
  select count(*) from public.optical_stock_movements
    where work_order_id=wid into rows_count;
  if rows_count<>1 then raise exception 'stock movement count not exactly once'; end if;
  select on_hand-reserved from public.optical_stock_bins where product_id=product into available;
  if available<>1 then raise exception 'pickup stock incorrect'; end if;
  select count(*) from public.optical_payment_ledger where work_order_id=wid into rows_count;
  if rows_count<>2 then raise exception 'duplicate deposit ledger rows'; end if;

  select o.duplicate_request into dupe from public.optical_transition_work_order_tx(
   t,b,wid,actor,'collected','00000000-0000-4000-8000-000000000804'::uuid) o;
  if not dupe then raise exception 'pickup replay not idempotent'; end if;

  -- Cancel an unpaid second job and release reservation, without touching
  -- previously collected inventory movement or payment.
  select c.work_order_id into wid2 from public.optical_create_work_order_tx(
    t,b,actor,actor,customer,null,
    jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1)),
    0,'00000000-0000-4000-8000-000000000603'::uuid,null,null) c;
  select reserved from public.optical_stock_bins where product_id=product into available;
  if available<>1 then raise exception 'second order reserve invalid'; end if;
  perform public.optical_transition_work_order_tx(t,b,wid2,actor,'cancelled',
    '00000000-0000-4000-8000-000000000805'::uuid);
  select reserved from public.optical_stock_bins where product_id=product into available;
  if available<>0 then raise exception 'cancellation failed to release reservation'; end if;
  begin
    perform public.optical_post_deposit_tx(t,b,wid2,actor,shift,
      '00000000-0000-4000-8000-000000000706'::uuid,100,'cash',null,null);
    raise exception 'EXPECTED_CANCELLED_DENIAL';
  exception when others then
    if SQLERRM<>'OPTICAL_BILL_PAID_OR_TERMINAL' then
      raise exception 'cancelled bill can accept money: %',SQLERRM; end if;
  end;

  -- Cross-tenant and contract gate: a food owner must not open Optical.
  begin
    perform public.optical_create_work_order_tx(
      '00000000-0000-4000-8000-000000000002'::uuid,
      '00000000-0000-4000-8000-000000000022'::uuid,
      '00000000-0000-4000-8000-000000000102'::uuid,
      '00000000-0000-4000-8000-000000000102'::uuid,customer,null,
      jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1)),0,
      '00000000-0000-4000-8000-000000000607'::uuid,null,null);
    raise exception 'EXPECTED_CROSS_TENANT_DENIAL';
  exception when others then
    if SQLERRM not in ('OPTICAL_WORK_ORDERS_NOT_APPROVED','OPTICAL_CUSTOMER_NOT_FOUND') then
      raise exception 'cross tenant denied unexpectedly: %',SQLERRM; end if;
  end;
end
$tests$;

-- The new selective guard MUST NOT block ordinary food order_items.
insert into public.order_items(tenant_id,branch_id,product_id) values
 ('00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000022',
  '00000000-0000-4000-8000-000000000202');
do $assert$
begin
  if (select count(*) from public.order_items)<>1 then
    raise exception 'regular restaurant item unexpectedly rejected'; end if;
  begin
    insert into public.order_items(tenant_id,branch_id,product_id) values (
     '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000011',
     '00000000-0000-4000-8000-000000000201');
    raise exception 'EXPECTED_OPTICAL_GENERIC_DENIAL';
  exception when others then
    if SQLERRM<>'OPTICAL_INVENTORY_ONLY_USE_WORK_ORDER_FLOW' then
      raise exception 'generic Optical stock bypass not prevented: %',SQLERRM; end if;
  end;
end
$assert$;
reset role;
select 'optical_postgres_scratch_smoke_passed' as outcome;
