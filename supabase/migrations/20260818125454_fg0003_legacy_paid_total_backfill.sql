with scope as (
  select t.id as tenant_id, b.id as branch_id
  from public.tenants t
  join public.branches b on b.tenant_id=t.id
  where t.code='FG0003' and b.code='FG0003-BKK-01'
), paid as (
  select p.tenant_id,p.branch_id,p.order_id,
         round(sum(p.amount),2)::numeric(12,2) as paid_amount
  from public.payments p
  join scope s on s.tenant_id=p.tenant_id and s.branch_id=p.branch_id
  where p.status='paid'
  group by p.tenant_id,p.branch_id,p.order_id
)
update public.orders o
set paid_total=p.paid_amount
from paid p
where o.id=p.order_id
  and o.tenant_id=p.tenant_id
  and o.branch_id=p.branch_id
  and o.status='completed'
  and abs(p.paid_amount - case when coalesce(o.grand_total,0)>0 then o.grand_total else coalesce(o.total_amount,0) end) <= 0.01
  and abs(coalesce(o.paid_total,0)-p.paid_amount)>0.01;
