import { normalizeCustomPosSalesModes } from "@/lib/pos-sales-modes";

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
