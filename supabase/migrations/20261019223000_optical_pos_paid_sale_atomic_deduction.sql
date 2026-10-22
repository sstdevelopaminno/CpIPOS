-- Atomic POS Optical stock deduction on payment. Staged for isolated QA only.
-- Must ship together with optical_adjust_stock_tx and matched API routes.
-- Ordinary packages and Optical work-order reservations are unaffected.
create table if not exists public.optical_pos_sale_stock_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  order_id uuid not null references public.orders(id),
  product_id uuid not null references public.products(id),
  stock_bin_id uuid not null references public.optical_stock_bins(id),
  paid_request_group_id text not null,
  quantity integer not null check(quantity>0),
  before_on_hand integer not null check(before_on_hand>=0),
  after_on_hand integer not null check(after_on_hand>=0),
  actor_user_id uuid not null references public.users_profiles(id),
  created_at timestamptz not null default now(),
  constraint optical_pos_sale_stock_ledger_one_deduction unique(tenant_id,branch_id,order_id,product_id)
);
create index if not exists optical_pos_sale_stock_ledger_product
  on public.optical_pos_sale_stock_ledger(tenant_id,branch_id,product_id,created_at desc);
alter table public.optical_pos_sale_stock_ledger enable row level security;
revoke all on public.optical_pos_sale_stock_ledger from public,anon,authenticated;

create or replace function public.optical_complete_pos_payment_tx(
  p_tenant_id uuid,p_branch_id uuid,p_order_id uuid,p_received_by uuid,
  p_payment_lines jsonb,p_request_group_id text default null
) returns table(payment_group_id text,total_paid numeric,order_status text,duplicate_request boolean)
language plpgsql security definer
set search_path to pg_catalog,public,app
set lock_timeout to '5s'
as $function$
declare
 v_order public.orders%rowtype;
 v_role text;
 v_valid integer;
 v_items integer;
 v_ledger integer;
 v_item record;
 v_bin public.optical_stock_bins%rowtype;
 v_payment record;
 v_request text;
begin
 -- Require POS backend service-role identity. End users must call authenticated API.
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
 then raise exception 'OPTICAL_PAYMENT_SERVICE_ROLE_REQUIRED';end if;
 if p_tenant_id is null or p_branch_id is null or p_order_id is null or p_received_by is null
   or p_request_group_id is null or length(btrim(p_request_group_id))<8
 then raise exception 'OPTICAL_PAYMENT_SCOPE_REQUIRED';end if;
 v_request:=btrim(p_request_group_id);
 select r.role::text into v_role from public.user_branch_roles r
 join public.users_profiles u on u.id=r.user_id
 join public.branches b on b.id=r.branch_id and b.tenant_id=r.tenant_id
 where r.user_id=p_received_by and r.tenant_id=p_tenant_id
   and r.branch_id=p_branch_id and u.is_active and u.archived_at is null
   and b.is_active and r.role::text in ('owner','manager','staff')
 limit 1;
 if v_role is null then raise exception 'OPTICAL_PAYMENT_CASHIER_FORBIDDEN';end if;
 select count(*) into v_valid from public.tenant_subscription_contracts c
 join public.subscription_packages pkg on pkg.id=c.package_id
 where c.tenant_id=p_tenant_id and c.status in ('active','trial')
   and (c.ended_at is null or c.ended_at>now());
 if v_valid<>1 then raise exception 'OPTICAL_PAYMENT_CONTRACT_AMBIGUOUS';end if;
 if not exists(select 1 from public.tenant_subscription_contracts c
   join public.subscription_packages pkg on pkg.id=c.package_id
   where c.tenant_id=p_tenant_id and c.status in ('active','trial')
   and (c.ended_at is null or c.ended_at>now()) and lower(pkg.code)='custom'
   and c.metadata->'sales_modes'->>'optical_retail'='true'
   and c.metadata->>'pos_currency_code'='LAK')
 then raise exception 'OPTICAL_PAYMENT_CONTRACT_NOT_LAK';end if;
 select * into v_order from public.orders o
 where o.id=p_order_id and o.tenant_id=p_tenant_id and o.branch_id=p_branch_id
 for update;
 if not found or v_order.status='cancelled' then raise exception 'OPTICAL_PAYMENT_ORDER_INVALID';end if;
 select count(*) into v_items from (
   select oi.product_id from public.order_items oi
   where oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id and oi.order_id=p_order_id
   group by oi.product_id
 ) i;
 if v_items<1 then raise exception 'OPTICAL_PAYMENT_NO_ITEMS';end if;
 select count(*) into v_ledger from public.optical_pos_sale_stock_ledger l
 where l.tenant_id=p_tenant_id and l.branch_id=p_branch_id and l.order_id=p_order_id;
 if v_ledger>0 and v_ledger<>v_items then raise exception 'OPTICAL_PAYMENT_LEDGER_PARTIAL';end if;
 -- No off-ledger pre-existing completed payment may masquerade as a safe replay.
 if v_ledger=0 and exists(select 1 from public.payments p
    where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id and p.order_id=p_order_id)
 then raise exception 'OPTICAL_PAYMENT_HISTORICAL_RECONCILIATION_REQUIRED';end if;
 -- Validate all products and quantities. No fractional stock or recipe components.
 for v_item in
  select oi.product_id,sum(oi.quantity)::integer as qty
  from public.order_items oi
  where oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id and oi.order_id=p_order_id
  group by oi.product_id order by oi.product_id
 loop
  if v_item.qty<1 or exists(select 1 from public.order_items oi where
    oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id and oi.order_id=p_order_id
    and oi.product_id=v_item.product_id and oi.quantity<>trunc(oi.quantity))
  then raise exception 'OPTICAL_PAYMENT_INVALID_ITEM_QUANTITY';end if;
  if not exists(select 1 from public.products p where p.id=v_item.product_id
     and p.tenant_id=p_tenant_id and p.branch_id=p_branch_id
     and p.stock_deduction_mode='unit_only'
     and p.metadata->>'business_mode'='optical_retail'
     and p.metadata->>'currency_code'='LAK' and p.is_active and p.deleted_at is null)
  then raise exception 'OPTICAL_PAYMENT_INVALID_PRODUCT_SCOPE';end if;
  if exists(select 1 from public.recipes r where r.tenant_id=p_tenant_id
    and r.branch_id=p_branch_id and r.product_id=v_item.product_id)
  then raise exception 'OPTICAL_PAYMENT_LEGACY_RECIPE_NOT_ALLOWED';end if;
  select * into v_bin from public.optical_stock_bins b
    where b.tenant_id=p_tenant_id and b.branch_id=p_branch_id
      and b.product_id=v_item.product_id for update;
  if not found then raise exception 'OPTICAL_PAYMENT_STOCK_NOT_RECEIVED';end if;
  if v_ledger=0 and v_bin.on_hand-v_bin.reserved<v_item.qty
  then raise exception 'OPTICAL_PAYMENT_INSUFFICIENT_AVAILABLE_STOCK';end if;
  if v_ledger>0 and not exists(select 1 from public.optical_pos_sale_stock_ledger l
   where l.tenant_id=p_tenant_id and l.branch_id=p_branch_id
   and l.order_id=p_order_id and l.product_id=v_item.product_id
   and l.stock_bin_id=v_bin.id and l.quantity=v_item.qty)
  then raise exception 'OPTICAL_PAYMENT_LEDGER_REPLAY_MISMATCH';end if;
 end loop;
 select * into v_payment from app.complete_pos_payment_tx(
   p_tenant_id,p_branch_id,p_order_id,p_received_by,p_payment_lines,v_request);
 if not found then raise exception 'OPTICAL_PAYMENT_RESULT_EMPTY';end if;
 if v_ledger>0 then
   if v_payment.duplicate_request is distinct from true then
     raise exception 'OPTICAL_PAYMENT_LEDGER_EXISTS_WITH_NEW_PAYMENT';end if;
   return query select v_payment.payment_group_id,v_payment.total_paid,
     v_payment.order_status,true;return;
 end if;
 if v_payment.duplicate_request is true then
   raise exception 'OPTICAL_PAYMENT_REPLAY_WITHOUT_STOCK_LEDGER';end if;
 for v_item in
  select oi.product_id,sum(oi.quantity)::integer as qty
  from public.order_items oi where oi.tenant_id=p_tenant_id
  and oi.branch_id=p_branch_id and oi.order_id=p_order_id
  group by oi.product_id order by oi.product_id
 loop
  select * into v_bin from public.optical_stock_bins b
   where b.tenant_id=p_tenant_id and b.branch_id=p_branch_id
     and b.product_id=v_item.product_id for update;
  update public.optical_stock_bins b set on_hand=b.on_hand-v_item.qty,updated_at=now()
   where b.id=v_bin.id and b.tenant_id=p_tenant_id and b.branch_id=p_branch_id
     and b.on_hand-b.reserved>=v_item.qty;
  if not found then raise exception 'OPTICAL_PAYMENT_STOCK_CONCURRENT_CHANGE';end if;
  insert into public.optical_pos_sale_stock_ledger(
    tenant_id,branch_id,order_id,product_id,stock_bin_id,paid_request_group_id,
    quantity,before_on_hand,after_on_hand,actor_user_id
  )values(p_tenant_id,p_branch_id,p_order_id,v_item.product_id,v_bin.id,
     v_payment.payment_group_id,v_item.qty,v_bin.on_hand,v_bin.on_hand-v_item.qty,p_received_by);
 end loop;
 insert into public.audit_logs(tenant_id,branch_id,actor_user_id,actor_role,
   action,target_table,target_id,metadata)
 values(p_tenant_id,p_branch_id,p_received_by,v_role,'optical_pos_sale_stock_deducted',
   'orders',p_order_id,jsonb_build_object(
   'request_group_id',v_request,'payment_total_lak',v_payment.total_paid,
   'item_count',v_items));
 return query select v_payment.payment_group_id,v_payment.total_paid,
   v_payment.order_status,false;
end;
$function$;
revoke all on function public.optical_complete_pos_payment_tx(uuid,uuid,uuid,uuid,jsonb,text)
 from public,anon,authenticated;
grant execute on function public.optical_complete_pos_payment_tx(uuid,uuid,uuid,uuid,jsonb,text)
 to service_role;

-- Block legacy generic POS RPC from bypassing Optical stock accounting.
-- Dedicated Optical wrapper calls app.complete_pos_payment_tx in the same TX.
create or replace function public.complete_pos_payment_tx(
  p_tenant_id uuid,p_branch_id uuid,p_order_id uuid,p_received_by uuid,
  p_payment_lines jsonb,p_request_group_id text default null
) returns table(payment_group_id text,total_paid numeric,order_status text,duplicate_request boolean)
language plpgsql security definer
set search_path to pg_catalog,public,app
as $wrapper$
begin
 if exists(select 1 from public.tenant_subscription_contracts c
    join public.subscription_packages pkg on pkg.id=c.package_id
    where c.tenant_id=p_tenant_id and c.status in ('active','trial')
      and (c.ended_at is null or c.ended_at>now())
      and lower(pkg.code)='custom'
      and c.metadata->'sales_modes'->>'optical_retail'='true')
 then raise exception 'OPTICAL_USE_ATOMIC_PAYMENT_RPC';end if;
 return query select * from app.complete_pos_payment_tx(
  p_tenant_id,p_branch_id,p_order_id,p_received_by,p_payment_lines,p_request_group_id);
end;
$wrapper$;
