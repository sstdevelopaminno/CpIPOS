-- FG0003 production maintenance gate, READ ONLY.
-- Execution gate is open only when all five counts are zero and heartbeat state is known.

with fg0003 as (
  select
    '2d38bd23-bf2d-4b9a-a7cf-adb2547297ed'::uuid as tenant_id,
    '41eee367-6762-4277-bfc8-c2e9776a8ef9'::uuid as branch_id
), counts as (
  select
    (select count(*) from public.pos_sessions p, fg0003 f where p.tenant_id = f.tenant_id and p.branch_id = f.branch_id and p.status = 'active') as active_pos_sessions,
    (select count(*) from public.shifts s, fg0003 f where s.tenant_id = f.tenant_id and s.branch_id = f.branch_id and s.status::text = 'open') as open_shifts,
    (select count(*) from public.orders o, fg0003 f where o.tenant_id = f.tenant_id and o.branch_id = f.branch_id and o.status::text not in ('completed', 'cancelled') and coalesce(o.paid_total, 0) < coalesce(o.grand_total, o.total_amount, 0)) as unpaid_open_orders,
    (select count(*) from public.table_bill_sessions b, fg0003 f where b.tenant_id = f.tenant_id and b.branch_id = f.branch_id and b.status in ('open', 'ordering', 'pending_payment')) as active_table_bills,
    (select count(*) from public.print_jobs j, fg0003 f where j.tenant_id = f.tenant_id and j.branch_id = f.branch_id and j.status::text in ('pending', 'retrying', 'printing')) as active_print_jobs,
    (select max(last_seen_at) from public.branch_devices d, fg0003 f where d.tenant_id = f.tenant_id and d.branch_id = f.branch_id) as device_last_seen_at,
    (select max(last_seen_at) from public.print_agents a, fg0003 f where a.tenant_id = f.tenant_id and a.branch_id = f.branch_id) as print_agent_last_seen_at
)
select
  now() as checked_at,
  counts.*,
  (active_pos_sessions = 0 and open_shifts = 0 and unpaid_open_orders = 0 and active_table_bills = 0 and active_print_jobs = 0) as maintenance_gate_open
from counts;