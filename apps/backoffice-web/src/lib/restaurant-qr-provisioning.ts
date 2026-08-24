import { RESTAURANT_QR_PRODUCT_PROFILE, RESTAURANT_QR_RESERVED_NEXT_STORE_CODE } from "./restaurant-qr-profile";

export const RESTAURANT_QR_STORE_PREFIX = "FG" as const;
export const RESTAURANT_QR_BRANCH_CODE_PATTERN = "FG0004-<LOCATION>-01" as const;
export const RESTAURANT_QR_UNKNOWN = "TBD" as const;

export type RestaurantQrProvisioningStatus = "PROVISIONING" | "READY_FOR_PREFLIGHT" | "BLOCKED";
export type RestaurantQrDeploymentMode = "CENTRAL" | "ISOLATED";
export type RestaurantQrUpdateRing = "LAB" | "PILOT" | "PRODUCTION" | "PRODUCTION_PROTECTED";
export type RestaurantQrQrGenerationMode = "SECURE_PER_TABLE" | "TBD";

export type RestaurantQrProvisioningManifest = {
  store_code: string;
  display_name: string;
  legal_name: string;
  product_profile: typeof RESTAURANT_QR_PRODUCT_PROFILE;
  package: string;
  deployment_mode: RestaurantQrDeploymentMode;
  update_ring: RestaurantQrUpdateRing;
  status: RestaurantQrProvisioningStatus;
  branches: Array<{
    branch_code: string;
    branch_name: string;
    location_code: string;
  }>;
  users_roles: Array<{
    role: string;
    user_display_name: string;
    employee_login_required: boolean | "TBD";
  }>;
  table_configuration: {
    table_count: number | "TBD";
    naming_scheme: string;
    qr_generation_mode: RestaurantQrQrGenerationMode;
    isolation_rules: string[];
  };
  pos_devices: Array<{
    device_code: string;
    device_name: string;
    device_type: "ANDROID_POS" | "WINDOWS_POS" | "CUSTOMER_DISPLAY" | "TBD";
    branch_code: string;
    registered_status: "NOT_REGISTERED" | "REGISTERED" | "TBD";
    mdm_profile: string;
    update_ring: RestaurantQrUpdateRing;
  }>;
  printer_devices: Array<{
    printer_code: string;
    role: "receipt" | "kitchen";
    branch_code: string;
    assignment_mode: "EXPLICIT_ONLY";
    automatic_reassignment: false;
  }>;
  features: string[];
  qr_table_options: {
    secure_identity_per_table: true;
    duplicate_normal_prints_allowed: false;
    internal_kitchen_child_popup_candidate: false;
  };
  mdm_update_profile: {
    app_package: "com.cpipos.pos";
    android_version_name_minimum: "1.0.20";
    android_version_code_minimum: 28;
    store_specific_apk: false;
    update_ring: RestaurantQrUpdateRing;
  };
  restaurant_qr_enablement: {
    product_profile: typeof RESTAURANT_QR_PRODUCT_PROFILE;
    registry_table: "app.restaurant_qr_store_registry";
    store_specific_business_branch: false;
  };
  preflight_checks: string[];
  postflight_checks: string[];
  eventual_live_provisioning: {
    transactional: true;
    idempotent: true;
    stop_if_store_code_exists: true;
    execute_now: false;
  };
  it_registry_fields: string[];
  missing_user_inputs: string[];
  safety: {
    db_writes: false;
    fg0003_modifications: false;
    other_store_modifications: false;
    copy_fg0003_data: false;
  };
};

export const FG0004_PROVISIONING_REQUIRED_INPUTS = [
  "Store display name",
  "Branch display name",
  "Province/city/location code",
  "Package",
  "Table count",
  "Table naming style",
  "POS device count",
  "POS hardware models",
  "Customer display YES/NO",
  "Receipt printer count/type",
  "Kitchen printer count/type",
  "Primary owner/manager user",
  "Employee login requirement",
  "Payment methods",
  "Opening date/time"
] as const;

export const RESTAURANT_QR_STANDARD_FEATURE_MANIFEST = [
  "pos_sales",
  "table_qr_ordering",
  "table_sessions",
  "qr_review_popup",
  "qr_accept_partial_accept_reject",
  "kitchen_dispatch",
  "kitchen_printer",
  "receipt_printer",
  "payments",
  "shift",
  "users_roles",
  "android_pos",
  "mdm",
  "customer_display_dual_screen_hardware_supported"
] as const;

export const FG0004_PROVISIONING_PREFLIGHT_CHECKS = [
  "store_code_fg0004_absent",
  "package_confirmed",
  "location_code_confirmed",
  "branch_code_available",
  "table_plan_confirmed",
  "device_plan_confirmed",
  "printer_plan_confirmed",
  "owner_manager_confirmed",
  "payment_methods_confirmed",
  "opening_datetime_confirmed"
] as const;

export const FG0004_PROVISIONING_POSTFLIGHT_CHECKS = [
  "tenant_created_once",
  "branch_created_once",
  "features_match_package",
  "secure_qr_identity_per_table",
  "new_printer_devices_profiles_assignments",
  "new_pos_devices_registered",
  "mdm_update_ring_pilot",
  "restaurant_qr_health_ok",
  "print_queue_isolated",
  "no_fg0003_rows_reused"
] as const;

export const RESTAURANT_QR_IT_REGISTRY_FIELDS = [
  "store_code",
  "display_name",
  "product_profile",
  "package",
  "deployment_mode",
  "update_ring",
  "status",
  "branch_count",
  "device_count",
  "device_heartbeat",
  "apk_versions",
  "mdm_state",
  "qr_health",
  "api_health",
  "print_queue",
  "printer_state",
  "active_incidents"
] as const;

export const FG0004_DRY_RUN_PROVISIONING_MANIFEST: RestaurantQrProvisioningManifest = {
  store_code: RESTAURANT_QR_RESERVED_NEXT_STORE_CODE,
  display_name: RESTAURANT_QR_UNKNOWN,
  legal_name: RESTAURANT_QR_UNKNOWN,
  product_profile: RESTAURANT_QR_PRODUCT_PROFILE,
  package: RESTAURANT_QR_UNKNOWN,
  deployment_mode: "CENTRAL",
  update_ring: "PILOT",
  status: "PROVISIONING",
  branches: [
    {
      branch_code: RESTAURANT_QR_BRANCH_CODE_PATTERN,
      branch_name: RESTAURANT_QR_UNKNOWN,
      location_code: RESTAURANT_QR_UNKNOWN
    }
  ],
  users_roles: [
    {
      role: "OWNER_MANAGER",
      user_display_name: RESTAURANT_QR_UNKNOWN,
      employee_login_required: RESTAURANT_QR_UNKNOWN
    }
  ],
  table_configuration: {
    table_count: RESTAURANT_QR_UNKNOWN,
    naming_scheme: RESTAURANT_QR_UNKNOWN,
    qr_generation_mode: "SECURE_PER_TABLE",
    isolation_rules: [
      "never_reuse_fg0003_table_ids",
      "never_reuse_fg0003_qr_tokens",
      "never_reuse_fg0003_qr_sessions",
      "fg0004_urls_resolve_only_to_fg0004_tenant_branch_table"
    ]
  },
  pos_devices: [
    {
      device_code: "FG0004-POS-01",
      device_name: RESTAURANT_QR_UNKNOWN,
      device_type: "ANDROID_POS",
      branch_code: RESTAURANT_QR_BRANCH_CODE_PATTERN,
      registered_status: "NOT_REGISTERED",
      mdm_profile: RESTAURANT_QR_UNKNOWN,
      update_ring: "PILOT"
    }
  ],
  printer_devices: [
    {
      printer_code: "FG0004-RECEIPT-01",
      role: "receipt",
      branch_code: RESTAURANT_QR_BRANCH_CODE_PATTERN,
      assignment_mode: "EXPLICIT_ONLY",
      automatic_reassignment: false
    },
    {
      printer_code: "FG0004-KITCHEN-01",
      role: "kitchen",
      branch_code: RESTAURANT_QR_BRANCH_CODE_PATTERN,
      assignment_mode: "EXPLICIT_ONLY",
      automatic_reassignment: false
    }
  ],
  features: [...RESTAURANT_QR_STANDARD_FEATURE_MANIFEST],
  qr_table_options: {
    secure_identity_per_table: true,
    duplicate_normal_prints_allowed: false,
    internal_kitchen_child_popup_candidate: false
  },
  mdm_update_profile: {
    app_package: "com.cpipos.pos",
    android_version_name_minimum: "1.0.20",
    android_version_code_minimum: 28,
    store_specific_apk: false,
    update_ring: "PILOT"
  },
  restaurant_qr_enablement: {
    product_profile: RESTAURANT_QR_PRODUCT_PROFILE,
    registry_table: "app.restaurant_qr_store_registry",
    store_specific_business_branch: false
  },
  preflight_checks: [...FG0004_PROVISIONING_PREFLIGHT_CHECKS],
  postflight_checks: [...FG0004_PROVISIONING_POSTFLIGHT_CHECKS],
  eventual_live_provisioning: {
    transactional: true,
    idempotent: true,
    stop_if_store_code_exists: true,
    execute_now: false
  },
  it_registry_fields: [...RESTAURANT_QR_IT_REGISTRY_FIELDS],
  missing_user_inputs: [...FG0004_PROVISIONING_REQUIRED_INPUTS],
  safety: {
    db_writes: false,
    fg0003_modifications: false,
    other_store_modifications: false,
    copy_fg0003_data: false
  }
};

export function buildRestaurantQrBranchCode(storeCode: string, locationCode: string, branchSequence = 1): string {
  const normalizedStore = String(storeCode).trim().toUpperCase();
  const normalizedLocation = String(locationCode).trim().toUpperCase();
  if (!/^FG\d{4}$/.test(normalizedStore)) throw new Error("restaurant_qr_store_code_invalid");
  if (!/^[A-Z0-9]{2,8}$/.test(normalizedLocation) || normalizedLocation === RESTAURANT_QR_UNKNOWN) {
    throw new Error("restaurant_qr_location_code_invalid");
  }
  if (!Number.isInteger(branchSequence) || branchSequence < 1 || branchSequence > 99) {
    throw new Error("restaurant_qr_branch_sequence_invalid");
  }
  return `${normalizedStore}-${normalizedLocation}-${String(branchSequence).padStart(2, "0")}`;
}
