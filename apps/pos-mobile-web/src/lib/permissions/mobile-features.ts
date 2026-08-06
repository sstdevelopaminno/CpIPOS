import type { BranchRole, MobilePermissionKey, PosFeatureCode } from "@/types/contracts";

export const mobilePermissionFeatures: Partial<Record<MobilePermissionKey, PosFeatureCode>> = {
  "sales:view": "core_pos_sales",
  "sales:create": "core_pos_sales",
  "sales:list:view": "advanced_sales_reports",
  "inventory:view": "stock_management",
  "tables:view": "table_management",
  "delivery:create": "delivery_ordering",
  "reports:view": "advanced_sales_reports",
  "receipts:view": "receipt_reprint_history",
  "settings:view": "core_pos_sales",
  "users:view": "user_management",
  "shift:open": "attendance_tracking",
  "shift:close": "attendance_tracking",
  "attendance:view_self": "attendance_tracking",
};

export const mobileRolePermissions: Record<BranchRole, MobilePermissionKey[]> = {
  owner: [
    "sales:view",
    "sales:create",
    "sales:list:view",
    "inventory:view",
    "tables:view",
    "delivery:create",
    "reports:view",
    "receipts:view",
    "settings:view",
    "users:view",
    "shift:open",
    "shift:close",
    "attendance:view_self",
  ],
  manager: [
    "sales:view",
    "sales:create",
    "sales:list:view",
    "inventory:view",
    "tables:view",
    "delivery:create",
    "reports:view",
    "receipts:view",
    "settings:view",
    "users:view",
    "shift:open",
    "shift:close",
    "attendance:view_self",
  ],
  staff: ["sales:view", "sales:create", "tables:view", "delivery:create", "shift:open", "shift:close", "attendance:view_self"],
  accountant: ["sales:list:view", "reports:view", "receipts:view"],
};

export function roleCan(role: BranchRole, permission: MobilePermissionKey) {
  return mobileRolePermissions[role].includes(permission);
}

export function featureForMobilePermission(permission: MobilePermissionKey) {
  return mobilePermissionFeatures[permission] ?? null;
}
