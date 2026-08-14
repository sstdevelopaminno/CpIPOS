-- Reduce future lock/scan cost on Primary hot tables by covering high-traffic foreign keys.
-- These indexes are deliberately narrow and nullable FK indexes are partial to avoid write bloat.

create index if not exists idx_orders_created_by on public.orders(created_by) where created_by is not null;
create index if not exists idx_orders_cancelled_by on public.orders(cancelled_by) where cancelled_by is not null;
create index if not exists idx_orders_payment_completed_by on public.orders(payment_completed_by) where payment_completed_by is not null;

create index if not exists idx_audit_logs_user_id on public.audit_logs(user_id) where user_id is not null;
create index if not exists idx_audit_logs_override_by_user_id on public.audit_logs(override_by_user_id) where override_by_user_id is not null;

create index if not exists idx_order_items_tenant_branch_order_id on public.order_items(tenant_id, branch_id, order_id);
create index if not exists idx_order_items_tenant_branch_product_id on public.order_items(tenant_id, branch_id, product_id);
create index if not exists idx_order_items_branch_id on public.order_items(branch_id);
create index if not exists idx_order_items_product_id on public.order_items(product_id);

create index if not exists idx_payments_received_by on public.payments(received_by) where received_by is not null;
create index if not exists idx_payments_transfer_verification_id on public.payments(transfer_verification_id) where transfer_verification_id is not null;
create index if not exists idx_payments_transfer_override_approval_id on public.payments(transfer_override_approval_id) where transfer_override_approval_id is not null;

create index if not exists idx_pos_device_incidents_latest_id on public.pos_device_incidents(latest_id) where latest_id is not null;
create index if not exists idx_pos_device_incidents_snapshot_id on public.pos_device_incidents(snapshot_id) where snapshot_id is not null;

create index if not exists idx_print_agents_device_id on public.print_agents(device_id) where device_id is not null;
create index if not exists idx_print_agents_created_by on public.print_agents(created_by) where created_by is not null;

create index if not exists idx_pos_sessions_shift_id on public.pos_sessions(shift_id) where shift_id is not null;

create index if not exists idx_print_jobs_printer_id on public.print_jobs(printer_id) where printer_id is not null;
create index if not exists idx_print_jobs_created_by on public.print_jobs(created_by) where created_by is not null;

create index if not exists idx_product_channel_prices_created_by on public.product_channel_prices(created_by) where created_by is not null;
create index if not exists idx_product_channel_prices_updated_by on public.product_channel_prices(updated_by) where updated_by is not null;

create index if not exists idx_stock_movements_created_by on public.stock_movements(created_by) where created_by is not null;
create index if not exists idx_shifts_closed_by on public.shifts(closed_by) where closed_by is not null;

create index if not exists idx_table_bill_sessions_opened_by on public.table_bill_sessions(opened_by) where opened_by is not null;
create index if not exists idx_table_bill_sessions_closed_by on public.table_bill_sessions(closed_by) where closed_by is not null;

create index if not exists idx_tenant_subscription_contracts_package_id on public.tenant_subscription_contracts(package_id) where package_id is not null;

analyze public.orders;
analyze public.audit_logs;
analyze public.order_items;
analyze public.payments;
analyze public.pos_device_incidents;
analyze public.print_agents;
analyze public.pos_sessions;
analyze public.print_jobs;
analyze public.product_channel_prices;
analyze public.stock_movements;
analyze public.shifts;
analyze public.table_bill_sessions;
analyze public.tenant_subscription_contracts;