-- DRAFT/REVIEW REQUIRED. This proposal is not installed into CpiPOS-001 yet.
-- Customer profile extends the SAME record; historical eye exams remain immutable.
alter table public.optical_customers add column if not exists address text;

-- Customer address changes have a separate audit trail, and never overwrite exams.
create table if not exists public.optical_customer_profile_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  customer_id uuid not null references public.optical_customers(id),
  actor_id uuid not null,
  request_id uuid not null,
  previous_address text,
  new_address text,
  changed_at timestamptz not null default now(),
  unique(tenant_id,branch_id,request_id)
);
alter table public.optical_customer_profile_audit enable row level security;
revoke all on public.optical_customer_profile_audit from PUBLIC,anon,authenticated;
grant select,insert on public.optical_customer_profile_audit to authenticated;
create policy optical_customer_address_audit_select
  on public.optical_customer_profile_audit for select to authenticated
  using (public.can_manage_optical_customer_data(tenant_id,branch_id));
create policy optical_customer_address_audit_insert
  on public.optical_customer_profile_audit for insert to authenticated
  with check (public.can_manage_optical_customer_data(tenant_id,branch_id)
    and actor_id=auth.uid());

create or replace function public.optical_save_customer_address_v1(
  p_tenant_id uuid,p_branch_id uuid,p_customer_id uuid,
  p_address text,p_request_id uuid
)
returns boolean
language plpgsql security invoker set search_path=public,pg_temp
as $
declare v_old text; v_new text;
begin
  if not public.can_manage_optical_customer_data(p_tenant_id,p_branch_id)
     or auth.uid() is null or p_request_id is null then
    raise exception 'OPTICAL_ADDRESS_UNAUTHORIZED'; end if;
  v_new:=nullif(left(btrim(p_address),1500),'');
  if exists(select 1 from public.optical_customer_profile_audit a
    where a.tenant_id=p_tenant_id and a.branch_id=p_branch_id
      and a.request_id=p_request_id) then
    if exists(select 1 from public.optical_customer_profile_audit a
      where a.tenant_id=p_tenant_id and a.branch_id=p_branch_id
        and a.request_id=p_request_id and a.customer_id=p_customer_id
        and a.new_address is not distinct from v_new) then return true; end if;
    raise exception 'OPTICAL_ADDRESS_IDEMPOTENCY_CONFLICT';
  end if;
  select c.address into v_old from public.optical_customers c
    where c.id=p_customer_id and c.tenant_id=p_tenant_id
      and c.branch_id=p_branch_id and c.deleted_at is null for update;
  if not found then raise exception 'OPTICAL_CUSTOMER_NOT_FOUND'; end if;
  if v_old is not distinct from v_new then return true; end if;
  insert into public.optical_customer_profile_audit(
    tenant_id,branch_id,customer_id,actor_id,request_id,previous_address,new_address
  ) values(p_tenant_id,p_branch_id,p_customer_id,auth.uid(),p_request_id,v_old,v_new);
  update public.optical_customers c set address=v_new,updated_at=now(),updated_by=auth.uid()
    where c.id=p_customer_id and c.tenant_id=p_tenant_id and c.branch_id=p_branch_id;
  return true;
end;
$;
revoke all on function public.optical_save_customer_address_v1(uuid,uuid,uuid,text,uuid)
  from PUBLIC,anon;
grant execute on function public.optical_save_customer_address_v1(uuid,uuid,uuid,text,uuid)
  to authenticated;

-- New work-order financial analytics never sum the separate restaurant orders or
-- reinterpret historical THB as LAK. Received deposits are payment cash flow,
-- while fulfilled orders are sales recognised at collection.
create or replace function public.optical_report_v1(
 p_tenant_id uuid,p_branch_id uuid,p_from timestamptz,p_to timestamptz
)
returns table(metric text,label text,quantity bigint,amount_lak numeric)
language plpgsql stable security invoker set search_path=public,pg_temp
as $
begin
 -- RLS already scopes Optical records. Financial reporting is further
 -- restricted to the owner; managers may manage customers but not see this.
 if auth.uid() is null or not exists(
   select 1 from public.user_branch_roles r
     join public.users_profiles u on u.id=r.user_id
   where r.user_id=auth.uid() and r.tenant_id=p_tenant_id
     and r.branch_id=p_branch_id and r.role::text='owner'
     and u.is_active and u.archived_at is null
 ) then raise exception 'OPTICAL_REPORT_OWNER_REQUIRED'; end if;
 return query
 with money as (
  select l.id,l.method,l.amount,l.received_at,w.seller_id
   from public.optical_payment_ledger l
   join public.optical_work_orders w on w.id=l.work_order_id
    and w.tenant_id=l.tenant_id and w.branch_id=l.branch_id
   where l.tenant_id=p_tenant_id and l.branch_id=p_branch_id
    and l.received_at>=p_from and l.received_at<p_to
    and l.currency_code='LAK'
 ), sales as (
   select w.id,w.seller_id,w.total_amount,w.collected_at
   from public.optical_work_orders w where w.tenant_id=p_tenant_id
     and w.branch_id=p_branch_id and w.status='collected'
     and w.collected_at>=p_from and w.collected_at<p_to
 )
 select 'payment_received'::text,'all'::text,count(*)::bigint,
        coalesce(sum(m.amount),0)::numeric from money m
 union all
 select 'payment_method'::text,m.method,count(*)::bigint,
        sum(m.amount)::numeric from money m group by m.method
 union all
 select 'seller_received'::text,m.seller_id::text,count(*)::bigint,
        sum(m.amount)::numeric from money m group by m.seller_id
 union all
 select 'fulfilled_sales'::text,'all'::text,count(*)::bigint,
        coalesce(sum(s.total_amount),0)::numeric from sales s
 union all
 select 'popular_product'::text,oi.sku_snapshot,sum(oi.quantity)::bigint,
        sum(oi.line_total)::numeric
   from sales s join public.optical_work_order_lines oi on oi.work_order_id=s.id
   where oi.tenant_id=p_tenant_id and oi.branch_id=p_branch_id
   group by oi.sku_snapshot;
end;
$;
revoke all on function public.optical_report_v1(uuid,uuid,timestamptz,timestamptz) from PUBLIC,anon;
grant execute on function public.optical_report_v1(uuid,uuid,timestamptz,timestamptz) to authenticated;
-- Only owner/manager can see optical reporting through existing RLS.
-- Monthly/yearly range is supplied by CRM with Asia/Vientiane day boundaries.
