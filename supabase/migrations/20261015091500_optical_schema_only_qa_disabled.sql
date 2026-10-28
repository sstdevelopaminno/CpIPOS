-- Stage 1: Optical schema-only, zero transaction writes, launch disabled.
-- This migration only CREATES Optical tables; no existing POS, kitchen,
-- payment, stock, contract or CRM table is modified.
-- No seeded products, financial transactions or grants for browser roles.
-- Rollout flags OPTICAL_FINANCE_V1_ENABLED and VITE_OPTICAL_OPS_V1_ENABLED
-- must remain OFF until backend security + shift E2E pass.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
create table if not exists public.optical_stock_bins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  product_id uuid not null references public.products(id),
  kind text not null check (kind in ('frame','lens','accessory')),
  brand text, model text, color text, frame_size text, lens_index text, lens_type text,
  lens_sph numeric(6,2), lens_cyl numeric(6,2),
  image_url text,
  unit text not null check (unit in ('piece','pair','set')),
  currency_code text not null default 'LAK' check (currency_code='LAK'),
  unit_price numeric(18,2) not null check(unit_price >= 0 and unit_price = trunc(unit_price)),
  on_hand integer not null default 0 check (on_hand >= 0),
  reserved integer not null default 0 check (reserved >= 0 and reserved <= on_hand),
  reorder_level integer not null default 1 check (reorder_level >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,branch_id,product_id),
  unique(id,tenant_id,branch_id)
);
create index if not exists idx_optical_stock_low on public.optical_stock_bins(tenant_id,branch_id,on_hand,reserved);

create table if not exists public.optical_work_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  branch_id uuid not null references public.branches(id),
  customer_id uuid not null references public.optical_customers(id),
  eye_exam_id uuid references public.optical_eye_exams(id),
  seller_id uuid not null,
  request_id uuid not null,
  request_payload_hash text not null,
  status text not null default 'received'
    check(status in ('received','lens_ordered','edging','ready_for_pickup','collected','cancelled')),
  currency_code text not null default 'LAK' check(currency_code='LAK'),
  subtotal numeric(18,2) not null check(subtotal>=0 and subtotal=trunc(subtotal)),
  discount_amount numeric(18,2) not null default 0 check(discount_amount>=0 and discount_amount=trunc(discount_amount)),
  total_amount numeric(18,2) not null check(total_amount>0 and total_amount=trunc(total_amount)),
  paid_total numeric(18,2) not null default 0 check(paid_total >= 0 and paid_total<=total_amount),
  accepted_at timestamptz not null default now(),
  due_at timestamptz,
  collected_at timestamptz,
  collected_request_id uuid,
  cancelled_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,branch_id,request_id),
  unique(id,tenant_id,branch_id),
  check(total_amount=subtotal-discount_amount),
  check(status <> 'collected' or (paid_total=total_amount and collected_at is not null))
);
create index if not exists idx_optical_work_orders_scope on public.optical_work_orders(tenant_id,branch_id,status,created_at desc);

create table if not exists public.optical_work_order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  work_order_id uuid not null,
  stock_bin_id uuid not null,
  product_id uuid not null references public.products(id),
  sku_snapshot text not null,
  description_snapshot text not null,
  quantity integer not null check(quantity>0),
  unit_price numeric(18,2) not null check(unit_price>=0 and unit_price=trunc(unit_price)),
  line_total numeric(18,2) generated always as (quantity*unit_price) stored,
  foreign key(work_order_id,tenant_id,branch_id)
    references public.optical_work_orders(id,tenant_id,branch_id),
  foreign key(stock_bin_id,tenant_id,branch_id)
    references public.optical_stock_bins(id,tenant_id,branch_id),
  unique(work_order_id,product_id),
  unique(id,tenant_id,branch_id)
);
create index if not exists idx_optical_lines_order on public.optical_work_order_lines(tenant_id,branch_id,work_order_id);

create table if not exists public.optical_stock_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  work_order_id uuid not null,
  stock_bin_id uuid not null,
  quantity integer not null check(quantity>0),
  status text not null default 'reserved' check(status in ('reserved','released','deducted')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key(work_order_id,tenant_id,branch_id)
    references public.optical_work_orders(id,tenant_id,branch_id),
  foreign key(stock_bin_id,tenant_id,branch_id)
    references public.optical_stock_bins(id,tenant_id,branch_id),
  unique(work_order_id,stock_bin_id),
  unique(id,tenant_id,branch_id)
);

create table if not exists public.optical_payment_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  work_order_id uuid not null,
  shift_id uuid not null references public.shifts(id),
  request_id uuid not null,
  currency_code text not null check(currency_code='LAK'),
  method text not null check(method in ('cash','bank_transfer')),
  amount numeric(18,2) not null check(amount>0 and amount=trunc(amount)),
  cumulative_paid numeric(18,2) not null check(cumulative_paid>0 and cumulative_paid=trunc(cumulative_paid)),
  reference_no text,
  verified_by uuid,
  received_by uuid not null,
  received_at timestamptz not null default now(),
  foreign key(work_order_id,tenant_id,branch_id)
    references public.optical_work_orders(id,tenant_id,branch_id),
  unique(tenant_id,branch_id,request_id),
  check(method='cash' or (reference_no is not null and verified_by is not null))
);
create index if not exists idx_optical_payments_order on public.optical_payment_ledger(tenant_id,branch_id,work_order_id,received_at);
create index if not exists idx_optical_payments_shift on public.optical_payment_ledger(tenant_id,branch_id,shift_id,received_at);

create table if not exists public.optical_work_order_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  work_order_id uuid not null,
  request_id uuid not null,
  previous_status text,
  next_status text not null,
  actor_id uuid not null,
  occurred_at timestamptz not null default now(),
  foreign key(work_order_id,tenant_id,branch_id)
    references public.optical_work_orders(id,tenant_id,branch_id),
  unique(tenant_id,branch_id,request_id)
);

create table if not exists public.optical_stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  reservation_id uuid not null,
  work_order_id uuid not null,
  stock_bin_id uuid not null,
  quantity_delta integer not null check(quantity_delta<0),
  reason text not null default 'optical_handover',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  foreign key(reservation_id,tenant_id,branch_id)
    references public.optical_stock_reservations(id,tenant_id,branch_id),
  foreign key(work_order_id,tenant_id,branch_id)
    references public.optical_work_orders(id,tenant_id,branch_id),
  foreign key(stock_bin_id,tenant_id,branch_id)
    references public.optical_stock_bins(id,tenant_id,branch_id),
  unique(reservation_id)
);
create index if not exists idx_optical_stock_movements_scope on public.optical_stock_movements(tenant_id,branch_id,created_at);


-- Strictest initial access policy: no browser access until QA approval.
ALTER TABLE public.optical_stock_bins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optical_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optical_work_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optical_stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optical_payment_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optical_work_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.optical_stock_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.optical_stock_bins,
  public.optical_work_orders,
  public.optical_work_order_lines,
  public.optical_stock_reservations,
  public.optical_payment_ledger,
  public.optical_work_order_events,
  public.optical_stock_movements FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.optical_stock_bins,
  public.optical_work_orders,
  public.optical_work_order_lines,
  public.optical_stock_reservations,
  public.optical_payment_ledger,
  public.optical_work_order_events,
  public.optical_stock_movements TO service_role;
COMMIT;
