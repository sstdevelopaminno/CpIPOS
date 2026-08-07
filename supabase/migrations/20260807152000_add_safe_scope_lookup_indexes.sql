-- Zero-behavior-change database housekeeping.
-- These indexes reflect existing multi-tenant query patterns only; no data,
-- constraints, RLS, functions, triggers, or application contracts are changed.

create index if not exists idx_recipes_tenant_branch_product
  on public.recipes (tenant_id, branch_id, product_id);

create index if not exists idx_stock_movements_scope_reference
  on public.stock_movements (tenant_id, branch_id, movement_type, ref_table, ref_id);

create index if not exists idx_user_branch_roles_tenant_branch_user
  on public.user_branch_roles (tenant_id, branch_id, user_id);
