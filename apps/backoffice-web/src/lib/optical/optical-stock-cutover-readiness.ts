/**
 * Preflight-only safety gate for transferring a legacy recipe-backed Optical
 * product into dedicated stock bins. Never mutates stock or orders.
 * Block until old POS sale_deduction and new reservation movement cannot
 * operate simultaneously on the same product.
 */
export type OpticalCutoverIssue =
  | "not_custom_optical"
  | "currency_not_lak"
  | "legacy_recipe_attached"
  | "unsettled_orders"
  | "existing_optical_bin"
  | "source_quantity_not_verified"
  | "requires_separate_price_approval";

export type OpticalCutoverReadiness = {
  ok: boolean;
  issues: OpticalCutoverIssue[];
};

export function evaluateOpticalStockCutover(input: {
  customOpticalApproved: boolean;
  salesCurrency: string;
  recipeLinks: number;
  unsettledOrderLines: number;
  opticalBinCount: number;
  reconciledOnHand: number | null;
  productPrice: number;
  approvedOpticalPrice: number | null;
}): OpticalCutoverReadiness {
  const issues: OpticalCutoverIssue[] = [];
  if (!input.customOpticalApproved) issues.push("not_custom_optical");
  if (input.salesCurrency !== "LAK") issues.push("currency_not_lak");
  if (input.recipeLinks !== 0) issues.push("legacy_recipe_attached");
  if (input.unsettledOrderLines !== 0) issues.push("unsettled_orders");
  if (input.opticalBinCount !== 0) issues.push("existing_optical_bin");
  if (input.reconciledOnHand === null ||
    !Number.isSafeInteger(input.reconciledOnHand) || input.reconciledOnHand < 0) {
    issues.push("source_quantity_not_verified");
  }
  if (input.approvedOpticalPrice === null ||
    !Number.isSafeInteger(input.approvedOpticalPrice) ||
    input.productPrice !== input.approvedOpticalPrice) {
    issues.push("requires_separate_price_approval");
  }
  return { ok: issues.length === 0, issues };
}
