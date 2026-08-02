import "server-only";

export const WINDOWS_RUNTIME_CONTRACT_VERSION = "2026-08-02.windows-runtime.v1";
export const WINDOWS_LOCAL_SCHEMA_VERSION = "0.1.0";
export const WINDOWS_RUNTIME_IDENTITY_ANCHOR = "store_code" as const;

export const WINDOWS_RUNTIME_FEATURE_KEYS = [
  "offline_sales_enabled",
  "local_database_enabled",
  "local_print_bridge_enabled",
  "cash_payment_offline_enabled",
  "receipt_print_offline_enabled",
  "shift_offline_enabled",
  "cloud_sync_enabled",
  "cloud_backup_enabled",
  "multi_branch_cloud_enabled",
  "advanced_reports_enabled",
  "inventory_enabled",
  "kitchen_display_enabled",
  "table_qr_ordering_enabled",
  "staff_attendance_enabled",
  "online_payment_enabled",
  "ai_feature_enabled"
] as const;

export type WindowsRuntimeFeatureKey = (typeof WINDOWS_RUNTIME_FEATURE_KEYS)[number];
export type WindowsRuntimeFeatureMap = Record<WindowsRuntimeFeatureKey, boolean>;

export type WindowsRuntimeEntitlementMode = "store_code_required" | "offline_only" | "cloud_package" | "test_full_access";

export type WindowsRuntimeBootstrapRequest = {
  store_code?: unknown;
  runtime_device_id?: unknown;
  device_code?: unknown;
  tenant_id?: unknown;
  branch_id?: unknown;
  app_version?: unknown;
  bridge_version?: unknown;
  dev_full_access?: unknown;
};

export type WindowsRuntimeBootstrapPayload = {
  contract_version: string;
  identity_anchor: typeof WINDOWS_RUNTIME_IDENTITY_ANCHOR;
  mode: WindowsRuntimeEntitlementMode;
  server_time: string;
  runtime: {
    store_code: string | null;
    store_code_required: boolean;
    device_code: string;
    runtime_device_id: string | null;
    app_version: string | null;
    bridge_version: string | null;
    test_machine: boolean;
  };
  license: {
    status: "active" | "not_activated" | "expired" | "suspended";
    license_type: "store_code_required" | "offline_only" | "cloud_package" | "test_full_access";
    package_code: "STORE_CODE_REQUIRED" | "OFFLINE_ONLY" | "CPIPOS_DEV_FULL" | "PACKAGE_REQUIRED";
    package_name: string;
    cloud_sync_allowed: boolean;
    expires_at: string | null;
    offline_grace_until: string | null;
  };
  entitlements: {
    features: WindowsRuntimeFeatureMap;
    limits: {
      max_local_devices: number | null;
      max_branches: number | null;
      max_offline_days: number | null;
      max_pending_sync_items: number | null;
    };
  };
  local_database: {
    enabled: boolean;
    provider: "sqlite";
    schema_version: string;
    recommended_path: string;
  };
  sync: {
    status: "disabled_store_code_required" | "disabled_offline_only" | "enabled_by_package" | "test_full_access";
    endpoint_prefix: string;
    order_sync_ready: boolean;
    requires_idempotency_key: boolean;
    validates_package_on_server: boolean;
  };
  warnings: string[];
};

const OFFLINE_ONLY_TRUE: WindowsRuntimeFeatureKey[] = [
  "offline_sales_enabled",
  "local_database_enabled",
  "local_print_bridge_enabled",
  "cash_payment_offline_enabled",
  "receipt_print_offline_enabled",
  "shift_offline_enabled"
];

export function parseWindowsRuntimeRequest(input: unknown): WindowsRuntimeBootstrapRequest {
  if (!input || typeof input !== "object") return {};
  return input as WindowsRuntimeBootstrapRequest;
}

export function buildWindowsRuntimeBootstrap(input: WindowsRuntimeBootstrapRequest): WindowsRuntimeBootstrapPayload {
  const storeCode = normalizeStoreCode(input.store_code);
  const devFullAccessRequested = toBoolean(input.dev_full_access);
  const devFullAccessAllowed = isDevFullAccessAllowed();
  const hasStoreCode = Boolean(storeCode);
  const testMachine = hasStoreCode && devFullAccessRequested && devFullAccessAllowed;
  const mode: WindowsRuntimeEntitlementMode = !hasStoreCode ? "store_code_required" : testMachine ? "test_full_access" : "offline_only";
  const deviceCode = readString(input.device_code) || "WINDOWS-POS-LOCAL";
  const runtimeDeviceId = readString(input.runtime_device_id);
  const appVersion = readString(input.app_version);
  const bridgeVersion = readString(input.bridge_version);
  const features = !hasStoreCode ? allFeatures(false) : testMachine ? allFeatures(true) : offlineOnlyFeatures();

  if (!hasStoreCode) {
    return buildStoreCodeRequiredPayload({
      deviceCode,
      runtimeDeviceId,
      appVersion,
      bridgeVersion,
      devFullAccessRequested,
      devFullAccessAllowed
    });
  }

  return {
    contract_version: WINDOWS_RUNTIME_CONTRACT_VERSION,
    identity_anchor: WINDOWS_RUNTIME_IDENTITY_ANCHOR,
    mode,
    server_time: new Date().toISOString(),
    runtime: {
      store_code: storeCode,
      store_code_required: true,
      device_code: deviceCode,
      runtime_device_id: runtimeDeviceId,
      app_version: appVersion,
      bridge_version: bridgeVersion,
      test_machine: testMachine
    },
    license: {
      status: "active",
      license_type: testMachine ? "test_full_access" : "offline_only",
      package_code: testMachine ? "CPIPOS_DEV_FULL" : "OFFLINE_ONLY",
      package_name: testMachine ? "CpIPOS Internal Test Full Access" : "CpIPOS Offline Only",
      cloud_sync_allowed: testMachine,
      expires_at: null,
      offline_grace_until: null
    },
    entitlements: {
      features,
      limits: {
        max_local_devices: testMachine ? null : 1,
        max_branches: testMachine ? null : 1,
        max_offline_days: testMachine ? null : 30,
        max_pending_sync_items: testMachine ? null : 5000
      }
    },
    local_database: {
      enabled: true,
      provider: "sqlite",
      schema_version: WINDOWS_LOCAL_SCHEMA_VERSION,
      recommended_path: "%LOCALAPPDATA%\\CpIPOS\\WindowsRuntime\\data\\cpipos-local.db"
    },
    sync: {
      status: testMachine ? "test_full_access" : "disabled_offline_only",
      endpoint_prefix: "/api/windows-runtime/v1/sync",
      order_sync_ready: false,
      requires_idempotency_key: true,
      validates_package_on_server: true
    },
    warnings: testMachine
      ? [
          "Store code anchor accepted for internal test machine mode.",
          "Internal test machine mode: all feature flags are enabled for development only.",
          "Order/payment cloud sync endpoints are contract-ready but not live order sync yet."
        ]
      : [
          "Store code anchor accepted. Current foundation phase returns offline-only until IT Backoffice package lookup is wired to this endpoint.",
          "Offline-only license: local sales and print features are allowed, cloud sync is locked until a cloud package is active.",
          "Order/payment cloud sync endpoints are contract-ready but not live order sync yet."
        ]
  };
}

export function isDevFullAccessAllowed() {
  return process.env.CPIPOS_WINDOWS_DEV_FULL_ACCESS === "1";
}

function buildStoreCodeRequiredPayload(input: {
  deviceCode: string;
  runtimeDeviceId: string | null;
  appVersion: string | null;
  bridgeVersion: string | null;
  devFullAccessRequested: boolean;
  devFullAccessAllowed: boolean;
}): WindowsRuntimeBootstrapPayload {
  return {
    contract_version: WINDOWS_RUNTIME_CONTRACT_VERSION,
    identity_anchor: WINDOWS_RUNTIME_IDENTITY_ANCHOR,
    mode: "store_code_required",
    server_time: new Date().toISOString(),
    runtime: {
      store_code: null,
      store_code_required: true,
      device_code: input.deviceCode,
      runtime_device_id: input.runtimeDeviceId,
      app_version: input.appVersion,
      bridge_version: input.bridgeVersion,
      test_machine: false
    },
    license: {
      status: "not_activated",
      license_type: "store_code_required",
      package_code: "STORE_CODE_REQUIRED",
      package_name: "Store code required",
      cloud_sync_allowed: false,
      expires_at: null,
      offline_grace_until: null
    },
    entitlements: {
      features: allFeatures(false),
      limits: {
        max_local_devices: 0,
        max_branches: 0,
        max_offline_days: 0,
        max_pending_sync_items: 0
      }
    },
    local_database: {
      enabled: true,
      provider: "sqlite",
      schema_version: WINDOWS_LOCAL_SCHEMA_VERSION,
      recommended_path: "%LOCALAPPDATA%\\CpIPOS\\WindowsRuntime\\data\\cpipos-local.db"
    },
    sync: {
      status: "disabled_store_code_required",
      endpoint_prefix: "/api/windows-runtime/v1/sync",
      order_sync_ready: false,
      requires_idempotency_key: true,
      validates_package_on_server: true
    },
    warnings: [
      "Store code is required before CpIPOS Windows can activate a license or package.",
      "The store code must be created and controlled by IT Backoffice.",
      input.devFullAccessRequested && !input.devFullAccessAllowed
        ? "Dev full access was requested but the server env CPIPOS_WINDOWS_DEV_FULL_ACCESS is not enabled."
        : "CpIPOS Web, CpIPOS Windows, and future CpIPOS mobile app must all start from the same store code anchor."
    ]
  };
}

function offlineOnlyFeatures(): WindowsRuntimeFeatureMap {
  const features = allFeatures(false);
  for (const key of OFFLINE_ONLY_TRUE) features[key] = true;
  return features;
}

function allFeatures(value: boolean): WindowsRuntimeFeatureMap {
  return Object.fromEntries(WINDOWS_RUNTIME_FEATURE_KEYS.map((key) => [key, value])) as WindowsRuntimeFeatureMap;
}

function normalizeStoreCode(value: unknown): string | null {
  const text = readString(value);
  if (!text) return null;
  return text.toUpperCase().replace(/\s+/g, "");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
  return false;
}
