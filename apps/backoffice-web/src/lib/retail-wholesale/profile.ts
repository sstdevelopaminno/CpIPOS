/** An explicit CUSTOM-only RW entitlement. For the first release the existing
 * SD engine flag must remain true for safe checkout and stored/held bill
 * compatibility. The new profile is not an automatic migration of SD stores.
 */
export const RETAIL_WHOLESALE_MODE_KEY = "retail_wholesale" as const;
export function isRetailWholesaleProfile(packageCode: unknown, rawModes: unknown): boolean {
  if (String(packageCode ?? "").trim().toLowerCase() !== "custom") return false;
  if (!rawModes || typeof rawModes !== "object" || Array.isArray(rawModes)) return false;
  const modes = rawModes as Record<string, unknown>;
  return modes.retail_wholesale === true && modes.general_sale === true &&
    ["takeaway", "home", "dine_in", "buffet_table", "delivery", "optical_retail", "recycling"]
      .every(key => modes[key] !== true);
}
