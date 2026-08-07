-- CpiPOS-002 Trial Data Plane foundation v1
-- Applied to Supabase project kawenyvpentwgugtzqec.
-- IMPORTANT: this migration belongs only to CpiPOS-002. Do not move it into supabase/migrations.

create schema if not exists app;

revoke all on schema app from public, anon, authenticated;
grant usage on schema app to service_role;

create type public.order_type as enum ('dine_in','takeaway','delivery_manual');
create type public.delivery_status as enum ('pending','preparing','completed','cancelled');
create type public.order_status as enum ('draft','queued','preparing','completed','cancelled');
create type public.payment_method as enum ('cash','bank_transfer');
create type public.stock_movement_type as enum ('purchase','sale_deduction','manual_adjustment','waste');

create table public.trial_tenant_scopes (
  tenant_id uuid primary key,
  lifecycle_status text not null default 'trial' check (lifecycle_status in ('trial','active','grace','expired','archived')),
  is_active boolean not null default true,
  source_control_plane text not null default 'CpiPOS-001',
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table public.trial_branch_scopes (
  tenant_id uuid not null references public.trial_tenant_scopes(tenant_id) on delete cascade,
  branch_id uuid not null,
  is_active boolean not null default true,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  primary key (tenant_id, branch_id),
  unique (branch_id)
);

create table public.trial_runtime_leases (
  pos_session_id uuid primary key,
  tenant_id uuid not null,
  branch_id uuid not null,
  shift_id uuid not null,
  user_id uuid not null,
  device_code text,
  status text not null default 'active' check (status in ('active','revoked','expired')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  synced_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade
);
create index idx_trial_runtime_leases_scope on public.trial_runtime_leases (tenant_id, branch_id, shift_id, user_id, expires_at desc) where status='active';

create table public.branch_inventory_settings (
  tenant_id uuid not null,
  branch_id uuid not null,
  allow_negative_stock boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (tenant_id, branch_id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade
);

create table public.tenant_tax_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.trial_tenant_scopes(tenant_id) on delete cascade,
  branch_id uuid,
  is_enabled boolean not null default false,
  calculation_base text not null default 'net_after_discount',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade
);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  name text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, name),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  sku text not null,
  name text not null,
  category text not null,
  price numeric not null check (price >= 0),
  is_combo boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  stock_deduction_mode text not null default 'unit_only' check (stock_deduction_mode in ('unit_only','recipe_deduction')),
  sell_unit text not null default 'unit',
  metadata jsonb not null default '{}'::jsonb,
  unique (tenant_id, branch_id, sku),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade
);
create index idx_products_scope_active_created on public.products (tenant_id, branch_id, is_active, created_at desc);
create index idx_products_stock_deduction_mode on public.products (tenant_id, branch_id, stock_deduction_mode, is_active);

create table public.product_combo_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  combo_product_id uuid not null,
  child_product_id uuid not null,
  qty numeric not null check (qty > 0),
  created_at timestamptz not null default now(),
  unique (combo_product_id, child_product_id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, combo_product_id) references public.products(tenant_id, branch_id, id) on delete cascade,
  foreign key (tenant_id, branch_id, child_product_id) references public.products(tenant_id, branch_id, id) on delete cascade
);

create table public.ingredients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  name text not null,
  base_unit text not null,
  quantity_on_hand numeric not null default 0,
  reorder_level numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  avg_unit_cost numeric not null default 0,
  last_purchase_unit_cost numeric not null default 0,
  unique (tenant_id, branch_id, name),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade
);

create table public.ingredient_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  ingredient_id uuid not null,
  package_name text not null,
  unit_count numeric not null check (unit_count > 0),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, ingredient_id) references public.ingredients(tenant_id, branch_id, id) on delete cascade
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  ingredient_id uuid not null,
  quantity_per_item numeric not null check (quantity_per_item > 0),
  applies_when_takeaway_only boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, ingredient_id, applies_when_takeaway_only),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, product_id) references public.products(tenant_id, branch_id, id) on delete cascade,
  foreign key (tenant_id, branch_id, ingredient_id) references public.ingredients(tenant_id, branch_id, id) on delete cascade
);
create index idx_recipes_tenant_branch_product on public.recipes (tenant_id, branch_id, product_id);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  ingredient_id uuid not null,
  movement_type public.stock_movement_type not null,
  quantity_delta numeric not null check (quantity_delta <> 0),
  reason text not null,
  ref_table text,
  ref_id uuid,
  approval_id uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  request_id text,
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, ingredient_id) references public.ingredients(tenant_id, branch_id, id)
);
create index idx_stock_movements_ingredient on public.stock_movements (tenant_id, branch_id, ingredient_id, created_at desc);
create index idx_stock_movements_scope_reference on public.stock_movements (tenant_id, branch_id, movement_type, ref_table, ref_id);
create unique index idx_stock_movements_tenant_branch_request_id on public.stock_movements (tenant_id, branch_id, request_id) where request_id is not null;

create table public.table_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  zone_name text not null,
  color text not null default '#0ea5e9',
  display_order integer not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, zone_name),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade
);

create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  zone_id uuid,
  table_code text not null,
  table_name text,
  capacity integer not null default 4 check (capacity > 0),
  status text not null default 'available' check (status in ('available','occupied','ordering','pending_payment','reserved','disabled')),
  shape text not null default 'rectangle' check (shape in ('square','rectangle','circle')),
  position_x numeric not null default 0,
  position_y numeric not null default 0,
  width numeric not null default 96,
  height numeric not null default 72,
  rotation numeric not null default 0,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, table_code),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, zone_id) references public.table_zones(tenant_id, branch_id, id) on delete set null
);
create index idx_dining_tables_tenant_branch_zone_code on public.dining_tables (tenant_id, branch_id, zone_id, table_code);

create table public.table_layout_objects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  zone_id uuid,
  object_type text not null check (object_type in ('counter','cashier','partition','plant','entrance','service_station')),
  object_name text,
  color text not null default '#334155',
  position_x numeric not null default 0,
  position_y numeric not null default 0,
  width numeric not null default 120,
  height numeric not null default 60,
  rotation numeric not null default 0,
  z_index integer not null default 1,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, zone_id) references public.table_zones(tenant_id, branch_id, id) on delete set null
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  shift_id uuid not null,
  order_no text not null,
  order_type public.order_type not null,
  channel text not null,
  delivery_status public.delivery_status,
  table_id uuid,
  external_order_code text,
  customer_name text,
  notes text,
  subtotal numeric not null,
  discount_amount numeric not null default 0,
  gp_amount numeric not null default 0,
  total_amount numeric not null,
  status public.order_status not null default 'draft',
  cancellation_approval_id uuid,
  cancelled_by uuid,
  cancelled_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivery_pricing_channel text,
  delivery_app_subtotal numeric,
  delivery_commission_rate_pct numeric,
  delivery_commission_amount numeric,
  delivery_commission_vat_rate_pct numeric,
  delivery_commission_vat_amount numeric,
  delivery_platform_fee_amount numeric,
  delivery_net_payout_amount numeric,
  delivery_pricing_source_url text,
  delivery_pricing_note text,
  request_id text,
  cash_received numeric,
  change_amount numeric,
  payment_completed_at timestamptz,
  payment_completed_by uuid,
  device_code text,
  cashier_user_id uuid,
  pos_session_id uuid,
  grand_total numeric not null default 0,
  tax_total numeric not null default 0,
  paid_total numeric not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  unique (tenant_id, branch_id, order_no),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, table_id) references public.dining_tables(tenant_id, branch_id, id)
);
create index idx_orders_tenant_branch_created on public.orders (tenant_id, branch_id, created_at desc);
create index idx_orders_scope_shift_created on public.orders (tenant_id, branch_id, shift_id, created_at desc);
create index idx_orders_pos_session on public.orders (pos_session_id, created_at desc);
create index idx_orders_device_code on public.orders (device_code, created_at desc);
create index idx_orders_cashier on public.orders (cashier_user_id, created_at desc);
create unique index idx_orders_tenant_branch_request_id on public.orders (tenant_id, branch_id, request_id) where request_id is not null;
create index idx_orders_shift_open_dine_in on public.orders (shift_id) where order_type='dine_in' and status not in ('completed','cancelled');

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  product_id uuid not null,
  quantity numeric not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  line_total numeric not null check (line_total >= 0),
  notes text,
  created_at timestamptz not null default now(),
  name text,
  metadata jsonb not null default '{}'::jsonb,
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, order_id) references public.orders(tenant_id, branch_id, id) on delete cascade,
  foreign key (tenant_id, branch_id, product_id) references public.products(tenant_id, branch_id, id)
);
create index idx_order_items_order on public.order_items (order_id);

create table public.transfer_payment_verifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  verified_by uuid not null,
  verification_status text not null check (verification_status in ('passed','failed','override_passed','error')),
  expected_amount numeric not null default 0,
  expected_promptpay_phone text,
  expected_payee_name text,
  parsed_payer_name text,
  parsed_payee_name text,
  parsed_amount numeric,
  parsed_transfer_datetime text,
  parsed_transaction_id text,
  parsed_reference_no text,
  ocr_confidence numeric,
  checks jsonb not null default '{}'::jsonb,
  parsed_payload jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  error_code text,
  error_message text,
  override_approval_id uuid,
  override_by uuid,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, order_id) references public.orders(tenant_id, branch_id, id) on delete cascade
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  order_id uuid not null,
  method public.payment_method not null,
  amount numeric not null check (amount > 0),
  reference_no text,
  received_by uuid not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  request_group_id text,
  transfer_verification_id uuid,
  transfer_override_approval_id uuid,
  shift_id uuid,
  pos_session_id uuid,
  status text not null default 'paid' check (status in ('pending','paid','voided','failed')),
  metadata jsonb not null default '{}'::jsonb,
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, order_id) references public.orders(tenant_id, branch_id, id) on delete cascade,
  foreign key (tenant_id, branch_id, transfer_verification_id) references public.transfer_payment_verifications(tenant_id, branch_id, id)
);
create index idx_payments_order on public.payments (order_id);
create index idx_payments_pos_session on public.payments (pos_session_id, created_at desc);
create index idx_payments_scope_shift_created on public.payments (tenant_id, branch_id, shift_id, created_at desc);
create unique index idx_payments_tenant_branch_order_request_group on public.payments (tenant_id, branch_id, order_id, request_group_id) where request_group_id is not null;

create table public.table_bill_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  table_id uuid not null,
  order_id uuid,
  opened_by uuid not null,
  closed_by uuid,
  status text not null default 'open' check (status in ('open','ordering','pending_payment','closed','cancelled')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, table_id) references public.dining_tables(tenant_id, branch_id, id) on delete cascade,
  foreign key (tenant_id, branch_id, order_id) references public.orders(tenant_id, branch_id, id) on delete set null
);
create unique index idx_table_bill_sessions_table_active on public.table_bill_sessions (table_id) where status in ('open','ordering','pending_payment');
create index idx_table_bill_sessions_tenant_branch_status on public.table_bill_sessions (tenant_id, branch_id, status, opened_at desc);
create index idx_table_bill_sessions_order_id on public.table_bill_sessions (order_id) where order_id is not null;

create table public.table_qr_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  table_id uuid not null,
  table_session_id uuid not null,
  status text not null default 'active' check (status in ('active','revoked','expired')),
  expires_at timestamptz not null,
  created_by uuid not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, table_id) references public.dining_tables(tenant_id, branch_id, id) on delete cascade,
  foreign key (tenant_id, branch_id, table_session_id) references public.table_bill_sessions(tenant_id, branch_id, id) on delete cascade
);
create unique index idx_table_qr_sessions_active_table_session on public.table_qr_sessions (table_session_id) where status='active';
create index idx_table_qr_sessions_scope on public.table_qr_sessions (tenant_id, branch_id, table_id, status, expires_at);

create table public.table_qr_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  table_id uuid not null,
  table_session_id uuid not null,
  qr_session_id uuid not null,
  order_id uuid,
  request_id text not null,
  item_count integer not null default 0 check (item_count >= 0),
  subtotal numeric not null default 0 check (subtotal >= 0),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  event_type text not null default 'order' check (event_type in ('order','call_staff','request_checkout')),
  unique (qr_session_id, request_id),
  foreign key (tenant_id, branch_id) references public.trial_branch_scopes(tenant_id, branch_id) on delete cascade,
  foreign key (tenant_id, branch_id, table_id) references public.dining_tables(tenant_id, branch_id, id) on delete cascade,
  foreign key (tenant_id, branch_id, table_session_id) references public.table_bill_sessions(tenant_id, branch_id, id) on delete cascade,
  foreign key (tenant_id, branch_id, qr_session_id) references public.table_qr_sessions(tenant_id, branch_id, id) on delete cascade,
  foreign key (tenant_id, branch_id, order_id) references public.orders(tenant_id, branch_id, id) on delete cascade
);
create index idx_table_qr_orders_table_session_created on public.table_qr_orders (tenant_id, branch_id, table_session_id, created_at desc);
create index idx_table_qr_orders_order_id on public.table_qr_orders (order_id) where order_id is not null;

create or replace function app.touch_trial_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_products_touch before update on public.products for each row execute function app.touch_trial_updated_at();
create trigger trg_ingredients_touch before update on public.ingredients for each row execute function app.touch_trial_updated_at();
create trigger trg_dining_tables_touch before update on public.dining_tables for each row execute function app.touch_trial_updated_at();
create trigger trg_table_zones_touch before update on public.table_zones for each row execute function app.touch_trial_updated_at();
create trigger trg_table_layout_objects_touch before update on public.table_layout_objects for each row execute function app.touch_trial_updated_at();
create trigger trg_orders_touch before update on public.orders for each row execute function app.touch_trial_updated_at();
create trigger trg_transfer_payment_verifications_touch before update on public.transfer_payment_verifications for each row execute function app.touch_trial_updated_at();
create trigger trg_table_bill_sessions_touch before update on public.table_bill_sessions for each row execute function app.touch_trial_updated_at();
create trigger trg_table_qr_sessions_touch before update on public.table_qr_sessions for each row execute function app.touch_trial_updated_at();
create trigger trg_tenant_tax_settings_touch before update on public.tenant_tax_settings for each row execute function app.touch_trial_updated_at();

create or replace function app.enforce_trial_ingredient_negative_stock()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app, extensions
as $$
declare
  v_allow boolean := false;
begin
  if new.quantity_on_hand >= 0 then return new; end if;
  select coalesce(b.allow_negative_stock,false) into v_allow
  from public.branch_inventory_settings b
  where b.tenant_id=new.tenant_id and b.branch_id=new.branch_id;
  if not coalesce(v_allow,false) then raise exception 'NEGATIVE_STOCK_NOT_ALLOWED'; end if;
  return new;
end;
$$;
create trigger trg_ingredients_negative_stock before insert or update of quantity_on_hand on public.ingredients for each row execute function app.enforce_trial_ingredient_negative_stock();

create or replace function app.revoke_trial_table_qr_session_on_bill_close()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app, extensions
as $$
begin
  if new.status in ('closed','cancelled') and old.status is distinct from new.status then
    update public.table_qr_sessions set status='revoked', revoked_at=coalesce(revoked_at,now())
    where tenant_id=new.tenant_id and branch_id=new.branch_id and table_session_id=new.id and status='active';
  end if;
  return new;
end;
$$;
create trigger trg_trial_revoke_qr_on_bill_close after update of status on public.table_bill_sessions for each row execute function app.revoke_trial_table_qr_session_on_bill_close();

alter table public.trial_tenant_scopes enable row level security;
alter table public.trial_branch_scopes enable row level security;
alter table public.trial_runtime_leases enable row level security;
alter table public.branch_inventory_settings enable row level security;
alter table public.tenant_tax_settings enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_combo_items enable row level security;
alter table public.ingredients enable row level security;
alter table public.ingredient_packages enable row level security;
alter table public.recipes enable row level security;
alter table public.stock_movements enable row level security;
alter table public.table_zones enable row level security;
alter table public.dining_tables enable row level security;
alter table public.table_layout_objects enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.transfer_payment_verifications enable row level security;
alter table public.payments enable row level security;
alter table public.table_bill_sessions enable row level security;
alter table public.table_qr_sessions enable row level security;
alter table public.table_qr_orders enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on function app.touch_trial_updated_at() from public, anon, authenticated;
revoke execute on function app.enforce_trial_ingredient_negative_stock() from public, anon, authenticated;
revoke execute on function app.revoke_trial_table_qr_session_on_bill_close() from public, anon, authenticated;
grant execute on function app.touch_trial_updated_at() to service_role;
grant execute on function app.enforce_trial_ingredient_negative_stock() to service_role;
grant execute on function app.revoke_trial_table_qr_session_on_bill_close() to service_role;
grant all on all tables in schema public to service_role;
