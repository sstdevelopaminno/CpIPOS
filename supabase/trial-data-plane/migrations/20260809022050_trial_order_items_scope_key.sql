-- Required by the Kitchen data-plane mirror so order-item references remain
-- tenant/branch scoped instead of relying on a global id alone.
create unique index if not exists ux_trial_order_items_scope_id
  on public.order_items(tenant_id, branch_id, id);
