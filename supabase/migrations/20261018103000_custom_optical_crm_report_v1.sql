-- Read-only Optical owner report. The UI already calls optical_report_v1,
-- but this RPC is absent from the current CpiPOS-001 database.
-- Deploy ONLY after the accompanying CRM-menu RLS migration is validated.
-- No shared POS orders/payments, restaurant stock or FX conversion is involved.
begin;

create or replace function public.optical_report_v1(
  p_tenant_id uuid, p_branch_id uuid,
  p_from timestamptz, p_to timestamptz
)
returns table(metric text, label text, quantity numeric, amount_lak numeric)
language plpgsql stable security invoker
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or p_tenant_id is null or p_branch_id is null
    or p_from is null or p_to is null
    or p_from >= p_to
    or p_from > now() + interval '1 day'
    or p_to - p_from > interval '366 days'
    or not public.can_manage_optical_customer_data(p_tenant_id,p_branch_id)
    or not app.custom_optical_finance_read_enabled(p_tenant_id)
    or not app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_reports')
    or not app.custom_optical_crm_menu_allowed(p_tenant_id,'main.crm_optical_orders')
  then
    raise exception 'OPTICAL_CRM_REPORT_ACCESS_DENIED' using errcode='42501';
  end if;
  return query with scoped_payments as (
    select p.work_order_id,p.received_by,p.amount
    from public.optical_payment_ledger p
    where p.tenant_id=p_tenant_id and p.branch_id=p_branch_id
      and p.currency_code='LAK'
      and p.received_at>=p_from and p.received_at<p_to
  ), scoped_collected as (
    select o.id,o.total_amount
    from public.optical_work_orders o
    where o.tenant_id=p_tenant_id and o.branch_id=p_branch_id
      and o.currency_code='LAK' and o.status='collected'
      and o.collected_at>=p_from and o.collected_at<p_to
  )
  select 'payment_received'::text, 'all'::text,
    count(*)::numeric,coalesce(sum(p.amount),0)::numeric
  from scoped_payments p
  union all
  select 'fulfilled_sales'::text, 'all'::text,
    count(*)::numeric,coalesce(sum(o.total_amount),0)::numeric
  from scoped_collected o
  union all
  select 'seller_received'::text,p.received_by::text,
    count(*)::numeric,coalesce(sum(p.amount),0)::numeric
  from scoped_payments p group by p.received_by
  union all
  select 'popular_product'::text,l.description_snapshot::text,
    coalesce(sum(l.quantity),0)::numeric,coalesce(sum(l.line_total),0)::numeric
  from scoped_collected o
  join public.optical_work_order_lines l
    on l.work_order_id=o.id
   and l.tenant_id=p_tenant_id and l.branch_id=p_branch_id
  group by l.description_snapshot;
end;
$function$;

revoke all on function public.optical_report_v1(uuid,uuid,timestamptz,timestamptz)
from public, anon;
grant execute on function public.optical_report_v1(uuid,uuid,timestamptz,timestamptz)
to authenticated;
commit;
