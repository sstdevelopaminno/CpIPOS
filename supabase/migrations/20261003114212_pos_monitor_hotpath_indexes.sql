create index if not exists idx_audit_logs_scope_action_created
  on public.audit_logs(tenant_id, branch_id, action, created_at desc);

create index if not exists idx_orders_scope_status_updated
  on public.orders(tenant_id, branch_id, status, updated_at desc);
