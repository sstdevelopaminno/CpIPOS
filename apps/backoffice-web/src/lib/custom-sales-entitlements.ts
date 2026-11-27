import { normalizeCustomPosSalesModes } from "@/lib/pos-sales-modes";
import { isCustomPosMenuVisible } from "@/lib/pos-menu-policy";

const POS_CASHIER_CODES = new Set(["core_pos_sales", "pos.sales.access", "pos_sales"]);

/**
 * An explicit sales-mode assignment on a current CUSTOM contract is the IT
 * authorization for the cashier's core feature. Merely choosing the CUSTOM
 * package is insufficient. Explicit per-branch/tenant feature denials are
 * applied by the caller before using this fallback.
 */
export function hasCustomSalesModeFeatureGrant(
  packageCode: unknown,
  rawModes: unknown,
  featureCode: string
): boolean {
  if (String(packageCode ?? "").toLowerCase() !== "custom") return false;
  const modes = normalizeCustomPosSalesModes(rawModes);
  const cashierModeSelected = modes.general_sale || modes.optical_retail || modes.recycling;
  if (POS_CASHIER_CODES.has(featureCode)) return cashierModeSelected;
  // The standalone Recycler workspace requires the stock catalogue as a
  // first-class module. Its explicit IT mode grant supplies that dependency.
  if (featureCode === "stock_management") return modes.recycling;
  if (featureCode === "barcode_scanner_mode") return cashierModeSelected;
  return false;
}

/** IT menu approval grants ONLY management navigation for explicitly enabled CUSTOM Recycling.
 * Never override an explicitly denied package feature, tenant or branch feature grant.
 */
export function hasCustomRecyclingManagementMenuGrant(args:{
 packageCode:unknown;rawModes:unknown;featureCode:string;
 menuEnabled:boolean;explicitFeatureOverride:boolean;
}):boolean{
 if(String(args.packageCode??"").trim().toLowerCase()!=="custom" || !args.menuEnabled || args.explicitFeatureOverride)return false;
 if(args.featureCode!=="branch_management"&&args.featureCode!=="user_management")return false;
 return normalizeCustomPosSalesModes(args.rawModes).recycling===true;
}

/** CUSTOM grocery contracts use IT's explicit module choices when there is no
 * separate package/tenant/branch feature decision. Do not infer commercial
 * entitlement from a single menu for a shared feature: all routes in the
 * report bundle must be approved before its underlying API feature is granted.
 * Standard packages, unrelated CUSTOM modes and explicit decisions are unchanged.
 */
const CUSTOM_GROCERY_MODULE_MENUS = {
  branch_management: ["settings.branches"],
  user_management: ["settings.users"],
  customer_facing_display: ["settings.display"],
  stock_management: ["more.stock"],
  receipt_reprint_history: ["more.receipts"],
  advanced_sales_reports: ["main.sales_list", "more.sales_summary", "more.product_sales"]
} as const;

export function customGroceryModuleMenuKeys(feature: string): readonly string[] {
  if (!Object.prototype.hasOwnProperty.call(CUSTOM_GROCERY_MODULE_MENUS, feature)) return [];
  return CUSTOM_GROCERY_MODULE_MENUS[feature as keyof typeof CUSTOM_GROCERY_MODULE_MENUS];
}

export function hasCustomGroceryModuleGrant(args: {
  packageCode: unknown;
  rawModes: unknown;
  featureCode: string;
  menuPolicy: Record<string, boolean>;
  explicitFeatureDecision: boolean;
}): boolean {
  if (String(args.packageCode ?? "").trim().toLowerCase() !== "custom" || args.explicitFeatureDecision) return false;
  const modes = normalizeCustomPosSalesModes(args.rawModes);
  // The existing Optical and Recycling workspaces retain their own policies.
  if (!modes.general_sale || modes.optical_retail || modes.recycling) return false;
  const keys = customGroceryModuleMenuKeys(args.featureCode);
  return keys.length > 0 && keys.every(key => isCustomPosMenuVisible(key, args.menuPolicy, true));
}

/** Notification preferences do not grant the restaurant QR ordering feature. */
export function hasCustomGroceryNotificationSettingsGrant(args: {
  packageCode: unknown;
  rawModes: unknown;
  menuPolicy: Record<string, boolean>;
  explicitFeatureDecision: boolean;
}): boolean {
  if (String(args.packageCode ?? "").trim().toLowerCase() !== "custom" || args.explicitFeatureDecision) return false;
  const modes = normalizeCustomPosSalesModes(args.rawModes);
  return modes.general_sale && !modes.optical_retail && !modes.recycling &&
    isCustomPosMenuVisible("settings.notifications", args.menuPolicy, true);
}
