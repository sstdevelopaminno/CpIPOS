-- Keep tenant_id/branch_id intact when a referenced order is deleted.
-- Only the nullable order_id should be cleared.

alter table public.table_bill_sessions
  drop constraint if exists table_bill_sessions_tenant_id_branch_id_order_id_fkey;

alter table public.table_bill_sessions
  add constraint table_bill_sessions_tenant_id_branch_id_order_id_fkey
  foreign key (tenant_id, branch_id, order_id)
  references public.orders(tenant_id, branch_id, id)
  on delete set null (order_id);
