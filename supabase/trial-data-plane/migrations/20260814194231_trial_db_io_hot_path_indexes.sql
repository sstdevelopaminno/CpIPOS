-- Cover Trial Data Plane composite foreign keys before trial traffic grows.
-- This keeps Trial business operations tenant/branch scoped and avoids future FK scan/lock amplification.

create index if not exists idx_trial_ingredient_packages_scope on public.ingredient_packages(tenant_id, branch_id);
create index if not exists idx_trial_ingredient_packages_scope_ingredient on public.ingredient_packages(tenant_id, branch_id, ingredient_id);

create index if not exists idx_trial_kitchen_ticket_items_scope_ticket on public.kitchen_ticket_items(tenant_id, branch_id, kitchen_ticket_id);
create index if not exists idx_trial_kitchen_ticket_items_scope_product on public.kitchen_ticket_items(tenant_id, branch_id, product_id) where product_id is not null;

create index if not exists idx_trial_kitchen_tickets_scope_zone on public.kitchen_tickets(tenant_id, branch_id, zone_id) where zone_id is not null;
create index if not exists idx_trial_kitchen_zones_scope_default_printer on public.kitchen_zones(tenant_id, branch_id, default_printer_id) where default_printer_id is not null;

create index if not exists idx_trial_order_items_scope_order on public.order_items(tenant_id, branch_id, order_id);
create index if not exists idx_trial_order_items_scope_product on public.order_items(tenant_id, branch_id, product_id);

create index if not exists idx_trial_orders_scope_table on public.orders(tenant_id, branch_id, table_id) where table_id is not null;
create index if not exists idx_trial_payments_scope_transfer_verification on public.payments(tenant_id, branch_id, transfer_verification_id) where transfer_verification_id is not null;

create index if not exists idx_trial_print_jobs_scope_order on public.print_jobs(tenant_id, branch_id, order_id) where order_id is not null;
create index if not exists idx_trial_print_jobs_scope_printer on public.print_jobs(tenant_id, branch_id, printer_id) where printer_id is not null;
create index if not exists idx_trial_print_jobs_scope_kitchen_ticket on public.print_jobs(tenant_id, branch_id, kitchen_ticket_id) where kitchen_ticket_id is not null;

create index if not exists idx_trial_printer_device_history_device on public.printer_device_history(printer_device_id) where printer_device_id is not null;
create index if not exists idx_trial_printer_device_history_profile on public.printer_device_history(printer_profile_id) where printer_profile_id is not null;

create index if not exists idx_trial_product_combo_items_scope_combo on public.product_combo_items(tenant_id, branch_id, combo_product_id);
create index if not exists idx_trial_product_combo_items_scope_child on public.product_combo_items(tenant_id, branch_id, child_product_id);
create index if not exists idx_trial_recipes_scope_ingredient on public.recipes(tenant_id, branch_id, ingredient_id);

create index if not exists idx_trial_table_bill_sessions_scope_order on public.table_bill_sessions(tenant_id, branch_id, order_id) where order_id is not null;
create index if not exists idx_trial_table_bill_sessions_scope_table on public.table_bill_sessions(tenant_id, branch_id, table_id);

create index if not exists idx_trial_table_layout_objects_scope on public.table_layout_objects(tenant_id, branch_id);
create index if not exists idx_trial_table_layout_objects_scope_zone on public.table_layout_objects(tenant_id, branch_id, zone_id) where zone_id is not null;

create index if not exists idx_trial_table_qr_orders_scope_qr_session on public.table_qr_orders(tenant_id, branch_id, qr_session_id) where qr_session_id is not null;
create index if not exists idx_trial_table_qr_orders_scope_order on public.table_qr_orders(tenant_id, branch_id, order_id) where order_id is not null;
create index if not exists idx_trial_table_qr_orders_scope_table on public.table_qr_orders(tenant_id, branch_id, table_id);
create index if not exists idx_trial_table_qr_sessions_scope_table_session on public.table_qr_sessions(tenant_id, branch_id, table_session_id) where table_session_id is not null;

create index if not exists idx_trial_transfer_payment_verifications_scope_order on public.transfer_payment_verifications(tenant_id, branch_id, order_id);

analyze public.ingredient_packages;
analyze public.kitchen_ticket_items;
analyze public.kitchen_tickets;
analyze public.kitchen_zones;
analyze public.order_items;
analyze public.orders;
analyze public.payments;
analyze public.print_jobs;
analyze public.printer_device_history;
analyze public.product_combo_items;
analyze public.recipes;
analyze public.table_bill_sessions;
analyze public.table_layout_objects;
analyze public.table_qr_orders;
analyze public.table_qr_sessions;
analyze public.transfer_payment_verifications;