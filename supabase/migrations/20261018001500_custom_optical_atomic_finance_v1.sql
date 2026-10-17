-- Optical-only, additive financial database functions and read-only CRM policies.
-- Rollout remains disabled by OPTICAL_FINANCE_V1_ENABLED and IT custom_features.
-- No contract activation, data seeding or stock migration.
-- NOT DEPLOYED. Existing optical_* tables are already present in CpiPOS-001.
-- Review/validate permissions and transactional invariants before applying.
-- Rollout is gated by OPTICAL_FINANCE_V1_ENABLED and per-tenant IT custom_features.
-- All mutations are Optical-only (NO common orders/payments/stock_movements writes).
-- Execute as service_role only, from POS routes that already require session, shift,
-- feature access and per-branch role. No browser-supplied tenant authorization.
create or replace function public.optical_create_work_order_tx(
  p_tenant_id uuid, p_branch_id uuid, p_actor uuid, p_seller_id uuid, p_customer_id uuid,
  p_eye_exam_id uuid, p_items jsonb, p_discount_lak numeric,
  p_request_id uuid, p_due_at timestamptz default null, p_note text default null
)
returns table(work_order_id uuid, duplicate_request boolean)
language plpgsql security invoker set search_path=pg_catalog,public,app
as $$
declare
  v_id uuid; v_bin record; v_entry record;
  v_qty integer; v_subtotal numeric(18,2):=0; v_discount numeric(18,2);
  v_entries jsonb:='[]'::jsonb; v_existing uuid; v_payload_hash text;
begin
  if p_request_id is null or p_actor is null or p_tenant_id is null or p_branch_id is null then
    raise exception 'OPTICAL_SCOPE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.users_profiles u
    join public.user_branch_roles r on r.user_id=u.id
    where u.id=p_actor and u.is_active and u.archived_at is null
      and r.tenant_id=p_tenant_id and r.branch_id=p_branch_id
      and r.role::text in ('owner','manager','staff')
  ) then raise exception 'OPTICAL_ACTOR_NOT_AUTHORIZED'; end if;
  -- Refuse ambiguous overlapping contracts rather than granting access based
  -- on one of multiple active agreements.
  if (select count(*) from public.tenant_subscription_contracts c
      where c.tenant_id=p_tenant_id and c.status in ('active','trial')
      and (c.ended_at is null or c.ended_at>now())) <> 1
  then raise exception 'OPTICAL_CONTRACT_AMBIGUOUS'; end if;
  if p_seller_id is not null and not exists(
    select 1 from public.users_profiles u
    join public.user_branch_roles r on r.user_id=u.id where u.id=p_seller_id
      and u.is_active and u.archived_at is null and r.tenant_id=p_tenant_id
      and r.branch_id=p_branch_id and r.role::text in('owner','manager','staff')
  ) then raise exception 'OPTICAL_SELLER_SCOPE_INVALID'; end if;
  if not exists (
    select 1 from public.tenant_subscription_contracts c
    join public.subscription_packages pkg on pkg.id=c.package_id
    where c.tenant_id=p_tenant_id and c.status in ('active','trial')
      and (c.ended_at is null or c.ended_at>now())
      and lower(pkg.code)='custom'
      and c.metadata->'sales_modes'->>'optical_retail'='true'
      and c.metadata->'custom_features'->>'optical_work_orders'='true'
  ) then raise exception 'OPTICAL_WORK_ORDERS_NOT_APPROVED'; end if;
  -- A repeated UUID with different items, discount or customer must NOT be
  -- mistaken for a successful replay, even when the request races.
  v_payload_hash:=md5(jsonb_build_object('customer',p_customer_id,'exam',p_eye_exam_id,
    'items',p_items,'seller',coalesce(p_seller_id,p_actor),'discount',coalesce(p_discount_lak,0),'due_at',p_due_at,
    'note',coalesce(p_note,''))::text);
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text||':'||p_branch_id::text||':'||p_request_id::text, 0));
  select w.id into v_existing from public.optical_work_orders w
  where w.tenant_id=p_tenant_id and w.branch_id=p_branch_id
    and w.request_id=p_request_id and w.request_payload_hash=v_payload_hash;
  if found then return query select v_existing,true; return; end if;
  if exists(select 1 from public.optical_work_orders w
    where w.tenant_id=p_tenant_id and w.branch_id=p_branch_id and w.request_id=p_request_id)
    then raise exception 'OPTICAL_CREATE_IDEMPOTENCY_CONFLICT'; end if;
  if not exists(select 1 from public.optical_customers c where c.id=p_customer_id
    and c.tenant_id=p_tenant_id and c.branch_id=p_branch_id and c.deleted_at is null) then
    raise exception 'OPTICAL_CUSTOMER_NOT_FOUND';
  end if;
  if p_eye_exam_id is not null and not exists(
    select 1 from public.optical_eye_exams e where e.id=p_eye_exam_id and e.customer_id=p_customer_id
    and e.tenant_id=p_tenant_id and e.branch_id=p_branch_id
  ) then raise exception 'OPTICAL_EYE_EXAM_SCOPE_INVALID'; end if;
  if jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>30 then
    raise exception 'OPTICAL_ITEMS_REQUIRED'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) j
    group by j->>'product_id' having count(*)>1) then
    raise exception 'OPTICAL_DUPLICATE_PRODUCT'; end if;
  for v_entry in select value from jsonb_array_elements(p_items) order by value->>'product_id'
  loop
    if (v_entry.value->>'product_id') is null or
       (v_entry.value->>'quantity') !~ '^[1-9][0-9]{0,5}$' then
      raise exception 'OPTICAL_INVALID_ITEM';
    end if;
    v_qty:=(v_entry.value->>'quantity')::integer;
    select b.*,p.sku,p.name,p.price,p.stock_deduction_mode
      into v_bin from public.optical_stock_bins b
    join public.products p on p.id=b.product_id and p.tenant_id=b.tenant_id and p.branch_id=b.branch_id
    where b.tenant_id=p_tenant_id and b.branch_id=p_branch_id
      and b.product_id=(v_entry.value->>'product_id')::uuid
      and p.is_active and p.deleted_at is null
    for update of b;
    if not found then raise exception 'OPTICAL_STOCK_BIN_NOT_FOUND'; end if;
    if v_bin.stock_deduction_mode<>'unit_only'
      or exists(select 1 from public.recipes r where r.tenant_id=p_tenant_id
                and r.branch_id=p_branch_id and r.product_id=v_bin.product_id)
      or v_bin.price<>v_bin.unit_price
      or v_bin.currency_code<>'LAK' then
      raise exception 'OPTICAL_LEGACY_RECIPE_OR_PRICE_REQUIRES_STOCK_CUTOVER'; end if;
    if v_bin.on_hand-v_bin.reserved < v_qty then raise exception 'OPTICAL_INSUFFICIENT_AVAILABLE_STOCK'; end if;
    v_subtotal:=v_subtotal+v_qty*v_bin.unit_price;
    v_entries:=v_entries||jsonb_build_array(jsonb_build_object(
      'bin_id',v_bin.id,'product_id',v_bin.product_id,'sku',v_bin.sku,
      'name',v_bin.name,'quantity',v_qty,'unit_price',v_bin.unit_price));
  end loop;
  v_discount:=coalesce(p_discount_lak,0);
  if v_discount<0 or v_discount<>trunc(v_discount) or v_discount>=v_subtotal then
    raise exception 'OPTICAL_DISCOUNT_INVALID'; end if;
  insert into public.optical_work_orders(tenant_id,branch_id,customer_id,eye_exam_id,
    seller_id,request_id,request_payload_hash,status,currency_code,
    subtotal,discount_amount,total_amount,due_at,note)
  values(p_tenant_id,p_branch_id,p_customer_id,p_eye_exam_id,coalesce(p_seller_id,p_actor),p_request_id,
    v_payload_hash,'received','LAK',v_subtotal,v_discount,v_subtotal-v_discount,p_due_at,left(p_note,1000))
  returning id into v_id;
  for v_entry in select value from jsonb_array_elements(v_entries)
  loop
    v_qty:=(v_entry.value->>'quantity')::integer;
    update public.optical_stock_bins b set reserved=b.reserved+v_qty,updated_at=now()
      where b.id=(v_entry.value->>'bin_id')::uuid and b.tenant_id=p_tenant_id and b.branch_id=p_branch_id
        and b.on_hand-b.reserved>=v_qty;
    if not found then raise exception 'OPTICAL_STOCK_CHANGED_CONCURRENTLY'; end if;
    insert into public.optical_work_order_lines(tenant_id,branch_id,work_order_id,stock_bin_id,
      product_id,sku_snapshot,description_snapshot,quantity,unit_price)
    values(p_tenant_id,p_branch_id,v_id,(v_entry.value->>'bin_id')::uuid,
      (v_entry.value->>'product_id')::uuid,v_entry.value->>'sku',
      v_entry.value->>'name',v_qty,(v_entry.value->>'unit_price')::numeric);
    insert into public.optical_stock_reservations(tenant_id,branch_id,work_order_id,stock_bin_id,quantity)
    values(p_tenant_id,p_branch_id,v_id,(v_entry.value->>'bin_id')::uuid,v_qty);
  end loop;
  insert into public.optical_work_order_events(
    tenant_id,branch_id,work_order_id,request_id,previous_status,next_status,actor_id)
    values(p_tenant_id,p_branch_id,v_id,p_request_id,null,'received',p_actor);
  return query select v_id,false;
end;
$$;
revoke all on function public.optical_create_work_order_tx(
uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,uuid,timestamptz,text) from PUBLIC,anon,authenticated;
grant execute on function public.optical_create_work_order_tx(
uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,uuid,timestamptz,text) to service_role;

create or replace function public.optical_post_deposit_tx(
  p_tenant_id uuid,p_branch_id uuid,p_work_order_id uuid,p_actor uuid,
  p_shift_id uuid,p_request_id uuid,p_amount_lak numeric,p_method text,
  p_transfer_reference text default null,p_verified_by uuid default null
)
returns table(payment_id uuid,paid_total numeric,remaining_amount numeric,duplicate_request boolean)
language plpgsql security invoker set search_path=pg_catalog,public,app
as $$
declare
 v_order public.optical_work_orders%rowtype; v_existing public.optical_payment_ledger%rowtype;
 v_id uuid; v_paid numeric(18,2);
begin
 if p_actor is null or p_request_id is null then raise exception 'OPTICAL_PAYMENT_SCOPE_REQUIRED'; end if;
 if not exists(select 1 from public.shifts s where s.id=p_shift_id
   and s.tenant_id=p_tenant_id and s.branch_id=p_branch_id and s.status::text='open')
 then raise exception 'OPTICAL_SHIFT_NOT_ACTIVE'; end if;
 if not exists(select 1 from public.users_profiles u
    join public.user_branch_roles r on r.user_id=u.id where u.id=p_actor
    and u.is_active and u.archived_at is null
    and r.tenant_id=p_tenant_id and r.branch_id=p_branch_id
    and r.role::text in ('owner','manager','staff')) then
   raise exception 'OPTICAL_PAYMENT_ACTOR_DENIED'; end if;
 if (select count(*) from public.tenant_subscription_contracts c
     where c.tenant_id=p_tenant_id and c.status in ('active','trial')
       and (c.ended_at is null or c.ended_at>now())) <> 1
 then raise exception 'OPTICAL_CONTRACT_AMBIGUOUS'; end if;
 if not exists(select 1 from public.tenant_subscription_contracts c
   join public.subscription_packages pkg on pkg.id=c.package_id
   where c.tenant_id=p_tenant_id and c.status in ('active','trial')
     and (c.ended_at is null or c.ended_at>now()) and lower(pkg.code)='custom'
     and c.metadata->'sales_modes'->>'optical_retail'='true'
     and c.metadata->'custom_features'->>'optical_deposit'='true') then
   raise exception 'OPTICAL_DEPOSIT_NOT_APPROVED'; end if;
 select * into v_order from public.optical_work_orders
  where id=p_work_order_id and tenant_id=p_tenant_id and branch_id=p_branch_id for update;
 if not found then raise exception 'OPTICAL_BILL_NOT_FOUND'; end if;
 select * into v_existing from public.optical_payment_ledger
   where tenant_id=p_tenant_id and branch_id=p_branch_id and request_id=p_request_id;
 if found then
   if v_existing.work_order_id<>p_work_order_id or v_existing.amount<>p_amount_lak
       or v_existing.method<>p_method or v_existing.shift_id<>p_shift_id
       or v_existing.received_by<>p_actor
       or (p_method='bank_transfer' and (
          v_existing.reference_no is distinct from nullif(left(trim(p_transfer_reference),120),'')
          or v_existing.verified_by is distinct from p_verified_by))
       then raise exception 'OPTICAL_IDEMPOTENCY_CONFLICT'; end if;
   return query select v_existing.id,v_order.paid_total,v_order.total_amount-v_order.paid_total,true;
   return;
 end if;
 if v_order.status in ('cancelled','collected') or v_order.paid_total>=v_order.total_amount then
   raise exception 'OPTICAL_BILL_PAID_OR_TERMINAL'; end if;
 if p_amount_lak is null or p_amount_lak<=0 or p_amount_lak<>trunc(p_amount_lak)
   or p_amount_lak>v_order.total_amount-v_order.paid_total then
   raise exception 'OPTICAL_PAYMENT_AMOUNT_INVALID'; end if;
 if p_method not in ('cash','bank_transfer') then raise exception 'OPTICAL_PAYMENT_METHOD_DENIED'; end if;
 if p_method='bank_transfer' then
   if length(coalesce(trim(p_transfer_reference),''))<6
      or p_verified_by is null
      or not exists(select 1 from public.user_branch_roles r
          join public.users_profiles u on u.id=r.user_id
          where r.user_id=p_verified_by and r.tenant_id=p_tenant_id and r.branch_id=p_branch_id
          and r.role::text in ('owner','manager') and u.is_active and u.archived_at is null) then
     raise exception 'OPTICAL_TRANSFER_REQUIRES_MANAGER_VERIFICATION'; end if;
 end if;
 v_paid:=v_order.paid_total+p_amount_lak;
 insert into public.optical_payment_ledger(
    tenant_id,branch_id,work_order_id,shift_id,request_id,currency_code,method,
    amount,cumulative_paid,reference_no,verified_by,received_by)
 values(p_tenant_id,p_branch_id,p_work_order_id,p_shift_id,p_request_id,'LAK',p_method,
    p_amount_lak,v_paid,nullif(left(trim(p_transfer_reference),120),''),p_verified_by,p_actor)
 returning id into v_id;
 update public.optical_work_orders
   set paid_total=v_paid,updated_at=now()
   where id=p_work_order_id and tenant_id=p_tenant_id and branch_id=p_branch_id;
 return query select v_id,v_paid,v_order.total_amount-v_paid,false;
end;
$$;
revoke all on function public.optical_post_deposit_tx(
uuid,uuid,uuid,uuid,uuid,uuid,numeric,text,text,uuid) from PUBLIC,anon,authenticated;
grant execute on function public.optical_post_deposit_tx(
uuid,uuid,uuid,uuid,uuid,uuid,numeric,text,text,uuid) to service_role;

create or replace function public.optical_transition_work_order_tx(
 p_tenant_id uuid,p_branch_id uuid,p_work_order_id uuid,p_actor uuid,
 p_next_status text,p_request_id uuid
)
returns table(status text,duplicate_request boolean)
language plpgsql security invoker set search_path=pg_catalog,public,app
as $$
declare v public.optical_work_orders%rowtype; r record; v_prior public.optical_work_order_events%rowtype;
begin
 if p_actor is null or p_request_id is null then raise exception 'OPTICAL_TRANSITION_SCOPE_REQUIRED'; end if;
 if not exists(select 1 from public.user_branch_roles b join public.users_profiles u on u.id=b.user_id
  where b.user_id=p_actor and b.tenant_id=p_tenant_id and b.branch_id=p_branch_id
    and b.role::text in ('owner','manager','staff') and u.is_active and u.archived_at is null)
 then raise exception 'OPTICAL_TRANSITION_DENIED'; end if;
 if (select count(*) from public.tenant_subscription_contracts c
     where c.tenant_id=p_tenant_id and c.status in ('active','trial')
       and (c.ended_at is null or c.ended_at>now())) <> 1
 then raise exception 'OPTICAL_CONTRACT_AMBIGUOUS'; end if;
 if not exists(select 1 from public.tenant_subscription_contracts c
   join public.subscription_packages pkg on pkg.id=c.package_id
   where c.tenant_id=p_tenant_id and c.status in('active','trial')
   and (c.ended_at is null or c.ended_at>now()) and lower(pkg.code)='custom'
   and c.metadata->'sales_modes'->>'optical_retail'='true'
   and c.metadata->'custom_features'->>'optical_work_orders'='true')
 then raise exception 'OPTICAL_WORK_ORDERS_NOT_APPROVED'; end if;
 select * into v from public.optical_work_orders
   where id=p_work_order_id and tenant_id=p_tenant_id and branch_id=p_branch_id for update;
 if not found then raise exception 'OPTICAL_WORK_ORDER_NOT_FOUND'; end if;
 select * into v_prior from public.optical_work_order_events e
   where e.tenant_id=p_tenant_id and e.branch_id=p_branch_id and e.request_id=p_request_id;
 if found then
   if v_prior.work_order_id<>p_work_order_id or v_prior.next_status<>p_next_status
     then raise exception 'OPTICAL_TRANSITION_IDEMPOTENCY_CONFLICT'; end if;
   return query select v.status,true; return;
 end if;
 if not ((v.status='received' and p_next_status in('lens_ordered','cancelled'))
     or (v.status='lens_ordered' and p_next_status in('edging','cancelled'))
     or (v.status='edging' and p_next_status in('ready_for_pickup','cancelled'))
     or (v.status='ready_for_pickup' and p_next_status in('collected','cancelled'))) then
   raise exception 'OPTICAL_INVALID_TRANSITION'; end if;
 if p_next_status='cancelled' and v.paid_total>0 then
   raise exception 'OPTICAL_REFUND_REQUIRED_BEFORE_CANCELLATION'; end if;
 if p_next_status='collected' and v.paid_total<>v.total_amount then
   raise exception 'OPTICAL_OUTSTANDING_BALANCE'; end if;
 if p_next_status='collected' then
   for r in select * from public.optical_stock_reservations s
      where s.work_order_id=p_work_order_id and s.tenant_id=p_tenant_id
      and s.branch_id=p_branch_id order by s.stock_bin_id for update loop
     if r.status<>'reserved' then raise exception 'OPTICAL_RESERVATION_ALREADY_CONSUMED'; end if;
     update public.optical_stock_bins b
        set on_hand=b.on_hand-r.quantity,reserved=b.reserved-r.quantity,updated_at=now()
        where b.id=r.stock_bin_id and b.tenant_id=p_tenant_id and b.branch_id=p_branch_id
          and b.reserved>=r.quantity and b.on_hand>=r.quantity;
     if not found then raise exception 'OPTICAL_RESERVED_STOCK_INCONSISTENT'; end if;
     insert into public.optical_stock_movements(tenant_id,branch_id,reservation_id,
      work_order_id,stock_bin_id,quantity_delta,created_by)
       values(p_tenant_id,p_branch_id,r.id,p_work_order_id,r.stock_bin_id,-r.quantity,p_actor);
     update public.optical_stock_reservations set status='deducted',completed_at=now()
       where id=r.id and tenant_id=p_tenant_id and branch_id=p_branch_id;
   end loop;
 elsif p_next_status='cancelled' then
   for r in select * from public.optical_stock_reservations s
     where s.work_order_id=p_work_order_id and s.tenant_id=p_tenant_id
       and s.branch_id=p_branch_id order by s.stock_bin_id for update loop
      if r.status<>'reserved' then raise exception 'OPTICAL_RESERVATION_ALREADY_CONSUMED'; end if;
      update public.optical_stock_bins b set reserved=b.reserved-r.quantity,updated_at=now()
        where b.id=r.stock_bin_id and b.tenant_id=p_tenant_id and b.branch_id=p_branch_id
         and b.reserved>=r.quantity;
      if not found then raise exception 'OPTICAL_RESERVED_STOCK_INCONSISTENT'; end if;
      update public.optical_stock_reservations set status='released',completed_at=now()
       where id=r.id and tenant_id=p_tenant_id and branch_id=p_branch_id;
   end loop;
 end if;
 update public.optical_work_orders w
   set status=p_next_status,updated_at=now(),
     collected_at=case when p_next_status='collected' then now() else w.collected_at end,
     collected_request_id=case when p_next_status='collected' then p_request_id else w.collected_request_id end,
     cancelled_at=case when p_next_status='cancelled' then now() else w.cancelled_at end
   where w.id=p_work_order_id and w.tenant_id=p_tenant_id and w.branch_id=p_branch_id;
 insert into public.optical_work_order_events(
  tenant_id,branch_id,work_order_id,request_id,previous_status,next_status,actor_id)
  values(p_tenant_id,p_branch_id,p_work_order_id,p_request_id,v.status,p_next_status,p_actor);
 return query select p_next_status,false;
end;
$$;
revoke all on function public.optical_transition_work_order_tx(
uuid,uuid,uuid,uuid,text,uuid) from PUBLIC,anon,authenticated;
grant execute on function public.optical_transition_work_order_tx(
uuid,uuid,uuid,uuid,text,uuid) to service_role;


-- A single POS checkout must atomically create the stock reservation AND
-- record verified funds. If the second call rejects, Postgres rolls back the
-- first one: no orphan work order or reserved stock.
create or replace function public.optical_open_with_deposit_tx(
 p_tenant_id uuid,p_branch_id uuid,p_actor uuid,p_shift_id uuid,
 p_customer_id uuid,p_seller_id uuid,p_items jsonb,p_discount_lak numeric,
 p_order_request_id uuid,p_payment_request_id uuid,
 p_amount_lak numeric,p_method text,p_transfer_reference text default null,
 p_verified_by uuid default null
)
returns table(work_order_id uuid,payment_id uuid,paid_total numeric,
 remaining_amount numeric,duplicate_request boolean)
language plpgsql security invoker set search_path=pg_catalog,public,app
as $optical_atomic$
declare v_order record;v_payment record;
begin
 if p_order_request_id is null or p_payment_request_id is null
   or p_order_request_id=p_payment_request_id
 then raise exception 'OPTICAL_IDEMPOTENCY_KEYS_INVALID';end if;
 select * into v_order from public.optical_create_work_order_tx(
   p_tenant_id,p_branch_id,p_actor,p_seller_id,p_customer_id,
   null,p_items,p_discount_lak,p_order_request_id,null,null);
 if not found or v_order.work_order_id is null
 then raise exception 'OPTICAL_ATOMIC_CREATE_FAILED';end if;
 select * into v_payment from public.optical_post_deposit_tx(
   p_tenant_id,p_branch_id,v_order.work_order_id,p_actor,p_shift_id,
   p_payment_request_id,p_amount_lak,p_method,p_transfer_reference,p_verified_by);
 if not found or v_payment.payment_id is null
 then raise exception 'OPTICAL_ATOMIC_PAYMENT_FAILED';end if;
 return query select v_order.work_order_id,v_payment.payment_id,
   v_payment.paid_total,v_payment.remaining_amount,v_payment.duplicate_request;
end;
$optical_atomic$;
revoke all on function public.optical_open_with_deposit_tx(
 uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,uuid,uuid,numeric,text,text,uuid)
 from PUBLIC,anon,authenticated;
grant execute on function public.optical_open_with_deposit_tx(
 uuid,uuid,uuid,uuid,uuid,uuid,jsonb,numeric,uuid,uuid,numeric,text,text,uuid)
 to service_role;

-- Stop reuse of the same bank transaction reference for a second Optical
-- payment at the same store/branch. No impact on cash payments.
create unique index if not exists optical_payment_unique_bank_reference_v1
on public.optical_payment_ledger(tenant_id,branch_id,reference_no)
where method='bank_transfer' and reference_no is not null;


-- PROPOSED ONLY: not applied to production until transactional migration verification.
-- Add read-only Optical finance access for the owner/manager CRM screen.
-- It is still explicitly controlled by the IT CUSTOM Optical entitlement.
create or replace function app.custom_optical_finance_read_enabled(p_tenant_id uuid)
returns boolean language sql stable security definer
set search_path=pg_catalog,public,app
as $function$
 select (select count(*) from public.tenant_subscription_contracts c
         where c.tenant_id=p_tenant_id and c.status in ('active','trial')
           and (c.ended_at is null or c.ended_at>now()))=1
   and exists(
      select 1 from public.tenant_subscription_contracts c
      join public.subscription_packages p on p.id=c.package_id
      where c.tenant_id=p_tenant_id and c.status in ('active','trial')
        and (c.ended_at is null or c.ended_at>now())
        and lower(p.code)='custom'
        and c.metadata->'sales_modes'->>'optical_retail'='true'
        and c.metadata->'custom_features'->>'optical_work_orders'='true'
   );
$function$;
revoke all on function app.custom_optical_finance_read_enabled(uuid) from public,anon;
grant execute on function app.custom_optical_finance_read_enabled(uuid) to authenticated,service_role;

do $policy$
declare name text;
begin
 foreach name in array array['optical_work_orders','optical_work_order_lines',
   'optical_stock_reservations','optical_payment_ledger','optical_work_order_events'] loop
   execute format('alter table public.%I enable row level security',name);
   execute format('revoke all on public.%I from public,anon,authenticated',name);
   execute format('grant select on public.%I to authenticated',name);
   if not exists(select 1 from pg_policies where schemaname='public'
                 and tablename=name and policyname=name||'_crm_read_v1') then
     execute format('create policy %I on public.%I for select to authenticated using (public.can_manage_optical_customer_data(tenant_id,branch_id) and app.custom_optical_finance_read_enabled(tenant_id))',
                    name||'_crm_read_v1',name);
   end if;
 end loop;
end;
$policy$;
-- NEVER grant browser write rights to the finance ledger. Cash mutations are
-- service-role only through idempotent Optical RPC + POS-session/shift/IT guard.
