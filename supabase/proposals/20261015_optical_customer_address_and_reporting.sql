-- DRAFT/REVIEW REQUIRED. This proposal is not installed into CpiPOS-001 yet.
-- Customer profile extends the SAME record; historical eye exams remain immutable.
alter table public.optical_customers add column if not exists address text;
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
