-- CpIPOS Windows local SQLite schema v0.1.0
-- Purpose: local offline-first foundation for Windows POS terminals.
-- This database is local to the Windows runtime and must never be treated as the server source of truth.
-- Store code is the required identity anchor across CpIPOS Web, CpIPOS Windows, and future CpIPOS app runtimes.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS local_schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS local_store_context (
  store_code TEXT PRIMARY KEY,
  tenant_id TEXT,
  tenant_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending_activation','active','expired','suspended')),
  source TEXT NOT NULL CHECK (source IN ('it_backoffice','offline_import','test_full_access')),
  last_verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS local_license (
  id TEXT PRIMARY KEY,
  store_code TEXT NOT NULL,
  license_type TEXT NOT NULL CHECK (license_type IN ('store_code_required','offline_only','cloud_package','test_full_access')),
  status TEXT NOT NULL CHECK (status IN ('active','not_activated','expired','suspended')),
  package_code TEXT NOT NULL,
  package_name TEXT NOT NULL,
  tenant_id TEXT,
  branch_id TEXT,
  device_code TEXT NOT NULL,
  runtime_device_id TEXT,
  cloud_sync_allowed INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  offline_grace_until TEXT,
  last_verified_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_code) REFERENCES local_store_context(store_code)
);

CREATE TABLE IF NOT EXISTS local_entitlements (
  store_code TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL CHECK (source IN ('store_code_required','offline_default','cloud_package','test_full_access','manual_it_override')),
  expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (store_code, feature_key),
  FOREIGN KEY (store_code) REFERENCES local_store_context(store_code)
);

CREATE TABLE IF NOT EXISTS local_device_context (
  id TEXT PRIMARY KEY,
  store_code TEXT NOT NULL,
  tenant_id TEXT,
  branch_id TEXT,
  device_code TEXT NOT NULL,
  device_name TEXT,
  runtime_device_id TEXT,
  app_version TEXT,
  bridge_version TEXT,
  registered_at TEXT,
  last_seen_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_code) REFERENCES local_store_context(store_code)
);

CREATE TABLE IF NOT EXISTS local_users_cache (
  user_id TEXT PRIMARY KEY,
  store_code TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  branch_id TEXT,
  display_name TEXT NOT NULL,
  role_code TEXT NOT NULL,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  pin_hash TEXT,
  cache_expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_code) REFERENCES local_store_context(store_code)
);

CREATE TABLE IF NOT EXISTS local_categories (
  category_id TEXT PRIMARY KEY,
  store_code TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  branch_id TEXT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_code) REFERENCES local_store_context(store_code)
);

CREATE TABLE IF NOT EXISTS local_products (
  product_id TEXT PRIMARY KEY,
  store_code TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  branch_id TEXT,
  category_id TEXT,
  name TEXT NOT NULL,
  sku TEXT,
  price REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_code) REFERENCES local_store_context(store_code),
  FOREIGN KEY (category_id) REFERENCES local_categories(category_id)
);

CREATE TABLE IF NOT EXISTS local_shifts (
  local_shift_id TEXT PRIMARY KEY,
  server_shift_id TEXT,
  store_code TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  device_code TEXT NOT NULL,
  opened_by_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','closed','sync_pending','synced','sync_failed')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opening_cash REAL NOT NULL DEFAULT 0,
  closing_cash REAL,
  idempotency_key TEXT NOT NULL UNIQUE,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_code) REFERENCES local_store_context(store_code)
);

CREATE TABLE IF NOT EXISTS local_orders (
  local_order_id TEXT PRIMARY KEY,
  server_order_id TEXT,
  store_code TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  device_code TEXT NOT NULL,
  local_shift_id TEXT,
  order_no TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','paid','cancelled','refunded','sync_pending','synced','sync_failed')),
  subtotal REAL NOT NULL DEFAULT 0,
  discount_total REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL,
  created_offline_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  last_sync_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_code) REFERENCES local_store_context(store_code),
  FOREIGN KEY (local_shift_id) REFERENCES local_shifts(local_shift_id)
);

CREATE TABLE IF NOT EXISTS local_order_items (
  local_order_item_id TEXT PRIMARY KEY,
  local_order_id TEXT NOT NULL,
  product_id TEXT,
  name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,
  discount_total REAL NOT NULL DEFAULT 0,
  tax_total REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  modifiers_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (local_order_id) REFERENCES local_orders(local_order_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS local_payments (
  local_payment_id TEXT PRIMARY KEY,
  server_payment_id TEXT,
  local_order_id TEXT NOT NULL,
  store_code TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','bank_transfer','qr','card','other')),
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending','paid','void','sync_pending','synced','sync_failed')),
  paid_offline_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  last_sync_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_code) REFERENCES local_store_context(store_code),
  FOREIGN KEY (local_order_id) REFERENCES local_orders(local_order_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS local_print_jobs (
  local_print_job_id TEXT PRIMARY KEY,
  local_order_id TEXT,
  store_code TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  printer_name TEXT,
  job_type TEXT NOT NULL CHECK (job_type IN ('receipt','kitchen_ticket','cash_drawer','test')),
  payload_text TEXT,
  payload_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','printed','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  printed_at TEXT,
  FOREIGN KEY (store_code) REFERENCES local_store_context(store_code),
  FOREIGN KEY (local_order_id) REFERENCES local_orders(local_order_id)
);

CREATE TABLE IF NOT EXISTS sync_queue (
  sync_item_id TEXT PRIMARY KEY,
  store_code TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('shift','order','payment','print_job','catalog_pull','license_refresh')),
  entity_local_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('create','update','void','pull')),
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending','in_progress','synced','failed','blocked')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (store_code) REFERENCES local_store_context(store_code)
);

CREATE TABLE IF NOT EXISTS sync_logs (
  sync_log_id TEXT PRIMARY KEY,
  sync_item_id TEXT,
  level TEXT NOT NULL CHECK (level IN ('info','warning','error')),
  message TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (sync_item_id) REFERENCES sync_queue(sync_item_id)
);

CREATE INDEX IF NOT EXISTS idx_local_license_store_code ON local_license(store_code, status);
CREATE INDEX IF NOT EXISTS idx_local_device_context_store_code ON local_device_context(store_code, device_code);
CREATE INDEX IF NOT EXISTS idx_local_orders_sync ON local_orders(sync_state, created_offline_at);
CREATE INDEX IF NOT EXISTS idx_local_payments_sync ON local_payments(sync_state, paid_offline_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, next_retry_at, created_at);
CREATE INDEX IF NOT EXISTS idx_sync_queue_store_code ON sync_queue(store_code, status, created_at);
CREATE INDEX IF NOT EXISTS idx_local_orders_tenant_branch ON local_orders(store_code, tenant_id, branch_id, created_offline_at);
CREATE INDEX IF NOT EXISTS idx_local_print_jobs_status ON local_print_jobs(status, created_at);

INSERT OR IGNORE INTO local_schema_migrations(version) VALUES ('0.1.0');
