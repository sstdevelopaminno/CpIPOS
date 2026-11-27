/** Explicit CUSTOM-only RW entitlement, independent of the SD licence.
 * Legacy contracts with both flags remain readable during rolling deployment.
 * The SD engine is an implementation detail, not a second selectable mode.
 */
export const RETAIL_WHOLESALE_MODE_KEY = "retail_wholesale" as const;
export function isRetailWholesaleProfile(packageCode: unknown, rawModes: unknown): boolean {
  if (String(packageCode ?? "").trim().toLowerCase() !== "custom") return false;
  if (!rawModes || typeof rawModes !== "object" || Array.isArray(rawModes)) return false;
  const modes = rawModes as Record<string, unknown>;
  return modes.retail_wholesale === true &&
    ["takeaway", "home", "dine_in", "buffet_table", "delivery", "optical_retail", "recycling"]
      .every(key => modes[key] !== true);
}

/** Compatibility view consumed only by the existing retail engine. Never
 * persist this projection to contract metadata, or use it as an SD licence.
 */
export function resolveRetailRuntimeModes<T extends { general_sale: boolean }>(
  packageCode: unknown, rawModes: unknown, selected: T
): T {
  return isRetailWholesaleProfile(packageCode, rawModes) ? { ...selected, general_sale: true } : selected;
}
