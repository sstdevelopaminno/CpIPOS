-- Phase 2.1 foundation: package feature matrix + tenant contract model

create table if not exists package_feature_catalog (
  code text primary key,
  name text not null,
  description text not null default '',
  default_monthly_price numeric(12,2) not null default 0,
  default_yearly_price numeric(12,2) not null default 0,
  default_perpetual_price numeric(12,2) not null default 0,
  included_by_default boolean not null default false,
  priced_per_branch boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists subscription_package_features (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references subscription_packages(id) on delete cascade,
  feature_code text not null references package_feature_catalog(code) on delete cascade,
  included boolean not null default false,
  custom_monthly_price numeric(12,2),
  custom_yearly_price numeric(12,2),
  custom_perpetual_price numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (package_id, feature_code)
);

create table if not exists tenant_subscription_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  package_id uuid not null references subscription_packages(id),
  contract_type text not null check (contract_type in ('saas', 'perpetual')),
  billing_interval text not null check (billing_interval in ('monthly', 'yearly')),
  deployment_mode text not null check (deployment_mode in ('cloud', 'desktop_online', 'desktop_offline', 'hybrid')),
  status text not null default 'active' check (status in ('active', 'suspended', 'expired', 'cancelled')),
  branch_limit integer not null default 1,
  terminal_limit_per_branch integer not null default 1,
  amount_per_cycle numeric(12,2) not null default 0,
  currency text not null default 'THB',
  auto_renew boolean not null default true,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tenant_feature_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  feature_code text not null references package_feature_catalog(code) on delete cascade,
  is_enabled boolean not null default true,
  price_monthly numeric(12,2),
  price_yearly numeric(12,2),
  price_perpetual numeric(12,2),
  source text not null default 'addon' check (source in ('package', 'addon', 'override')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, feature_code)
);

create index if not exists idx_spf_package on subscription_package_features(package_id);
create index if not exists idx_tsc_tenant on tenant_subscription_contracts(tenant_id, status, created_at desc);
create index if not exists idx_tfs_tenant_branch on tenant_feature_subscriptions(tenant_id, branch_id, is_enabled);

create trigger trg_package_feature_catalog_touch before update on package_feature_catalog for each row execute function app.touch_updated_at();
create trigger trg_subscription_package_features_touch before update on subscription_package_features for each row execute function app.touch_updated_at();
create trigger trg_tenant_subscription_contracts_touch before update on tenant_subscription_contracts for each row execute function app.touch_updated_at();
create trigger trg_tenant_feature_subscriptions_touch before update on tenant_feature_subscriptions for each row execute function app.touch_updated_at();

insert into package_feature_catalog (
  code,
  name,
  description,
  default_monthly_price,
  default_yearly_price,
  default_perpetual_price,
  included_by_default,
  priced_per_branch,
  is_active
)
values
  ('core_pos_sales', 'Core POS Sales', 'หน้าขายพื้นฐาน สร้างออเดอร์ คิดเงิน และออกใบเสร็จ', 0, 0, 0, true, false, true),
  ('table_management', 'Table Management', 'เปิดโต๊ะ ย้ายโต๊ะ จัดโซนโต๊ะ และตามสถานะบิล', 490, 5880, 8900, false, true, true),
  ('qr_table_ordering', 'QR Table Ordering', 'ลูกค้าสแกน QR และส่งรายการเข้าหน้าขาย', 690, 8280, 14900, false, true, true),
  ('customer_facing_display', 'Customer Display', 'หน้าจอลูกค้าดูรายการสินค้าและยอดรวมแบบเรียลไทม์', 250, 3000, 4900, false, false, true),
  ('transfer_slip_verification', 'Transfer Slip Verification', 'อัปโหลดสลิปโอนและตรวจสอบก่อนปิดบิล', 390, 4680, 6900, false, true, true),
  ('staff_qr_clockin', 'Staff QR Clock-in', 'สแกน QR ยืนยันตัวตนและลงเวลาเข้าใช้งาน', 190, 2280, 3900, false, true, true),
  ('advanced_sales_reports', 'Advanced Sales Reports', 'รายงานสรุปยอดขายเชิงลึกหลายสาขา', 790, 9480, 16900, false, false, true),
  ('receipt_reprint_history', 'Receipt Reprint History', 'ค้นหาและพิมพ์ใบเสร็จย้อนหลังพร้อม audit', 290, 3480, 5900, false, true, true),
  ('multi_terminal_sync', 'Multi Terminal Sync', 'หลายเครื่องต่อสาขา ซิงก์สถานะขายร่วมกัน', 590, 7080, 12900, false, true, true),
  ('offline_queue_resilience', 'Offline Queue Resilience', 'คิวออฟไลน์และ retry อัตโนมัติ', 350, 4200, 6900, false, true, true),
  ('desktop_app_runtime', 'Desktop App Runtime', 'ติดตั้งเป็นโปรแกรมบนคอมพิวเตอร์ รองรับ online/offline', 450, 5400, 10900, false, false, true),
  ('barcode_scanner_mode', 'Barcode Scanner Mode', 'รองรับร้านของชำ เครื่องยิงบาร์โค้ด และ fast checkout', 290, 3480, 5900, false, true, true),
  ('kitchen_printing', 'Kitchen Printing', 'ส่งบิลครัวแยกเครื่องพิมพ์ตาม station', 350, 4200, 6900, false, true, true)
on conflict (code) do nothing;

alter table package_feature_catalog enable row level security;
alter table subscription_package_features enable row level security;
alter table tenant_subscription_contracts enable row level security;
alter table tenant_feature_subscriptions enable row level security;

create policy package_feature_catalog_read
on package_feature_catalog
for select
to authenticated
using (true);

create policy package_feature_catalog_it_admin_manage
on package_feature_catalog
for all
using (app.is_it_admin())
with check (app.is_it_admin());

create policy subscription_package_features_read
on subscription_package_features
for select
using (
  app.is_it_admin()
  or exists (
    select 1
    from tenants t
    where t.package_id = subscription_package_features.package_id
      and app.has_tenant_access(t.id)
  )
);

create policy subscription_package_features_it_admin_manage
on subscription_package_features
for all
using (app.is_it_admin())
with check (app.is_it_admin());

create policy tenant_subscription_contracts_tenant_read
on tenant_subscription_contracts
for select
using (app.has_tenant_access(tenant_id));

create policy tenant_subscription_contracts_it_admin_manage
on tenant_subscription_contracts
for all
using (app.is_it_admin())
with check (app.is_it_admin());

create policy tenant_feature_subscriptions_tenant_read
on tenant_feature_subscriptions
for select
using (
  app.has_tenant_access(tenant_id)
  and (branch_id is null or app.has_branch_access(tenant_id, branch_id))
);

create policy tenant_feature_subscriptions_it_admin_manage
on tenant_feature_subscriptions
for all
using (app.is_it_admin())
with check (app.is_it_admin());
