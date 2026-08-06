export type BranchRole = "owner" | "manager" | "staff" | "accountant";

export type PosFeatureCode =
  | "core_pos_sales"
  | "pin_login"
  | "attendance_tracking"
  | "device_management"
  | "user_management"
  | "inet_nops_qr"
  | "advanced_sales_reports"
  | "stock_management"
  | "receipt_reprint_history"
  | "table_management"
  | "delivery_ordering"
  | "customer_facing_display"
  | "branch_management"
  | "mobile_device_enrollment"
  | "qr_table_ordering";

export type MobilePermissionKey =
  | "sales:view"
  | "sales:create"
  | "sales:list:view"
  | "inventory:view"
  | "tables:view"
  | "delivery:create"
  | "reports:view"
  | "receipts:view"
  | "settings:view"
  | "users:view"
  | "shift:open"
  | "shift:close"
  | "attendance:view_self";

export type ApiError = { code: string; message: string };
export type ApiResponse<T> = { data: T; error: null } | { data: null; error: ApiError };

export type MobileScope = {
  tenantId: string;
  branchId: string;
  userId: string;
  role: BranchRole;
  sessionId: string;
  deviceId: string;
  deviceCode: string;
  deviceName?: string | null;
};
