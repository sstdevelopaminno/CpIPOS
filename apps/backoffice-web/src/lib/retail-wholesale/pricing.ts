/** RW pricing domain only. Integer satang / integer base units; no floating
 * point prices or client-supplied totals. Not yet wired to order posting.
 */
export type WholesaleTier = { minBaseUnits: number; unitPriceSatang: number };
export type RetailUnit = { code: string; baseUnits: number };
const validInt = (n: number, minimum: number) => Number.isSafeInteger(n) && n >= minimum;
export function quoteRetailWholesale(input: {
  retailPriceSatang: number;
  units: RetailUnit[];
  tiers: WholesaleTier[];
  unitCode: string;
  quantity: number;
  priceMode: "retail" | "wholesale";
}) {
  if (!validInt(input.retailPriceSatang, 0) || !validInt(input.quantity, 1)) throw new Error("rw_invalid_price_or_quantity");
  const codes = new Set<string>();
  for (const unit of input.units) {
    if (!unit.code || codes.has(unit.code) || !validInt(unit.baseUnits, 1)) throw new Error("rw_invalid_unit");
    codes.add(unit.code);
  }
  const unit = input.units.find(u => u.code === input.unitCode);
  if (!unit) throw new Error("rw_unknown_unit");
  const baseQuantity = input.quantity * unit.baseUnits;
  if (!validInt(baseQuantity, 1)) throw new Error("rw_quantity_overflow");
  const thresholds = new Set<number>();
  for (const tier of input.tiers) {
    if (!validInt(tier.minBaseUnits, 1) || thresholds.has(tier.minBaseUnits) ||
      !validInt(tier.unitPriceSatang, 0) || tier.unitPriceSatang > input.retailPriceSatang) throw new Error("rw_invalid_tier");
    thresholds.add(tier.minBaseUnits);
  }
  if (input.priceMode !== "retail" && input.priceMode !== "wholesale") throw new Error("rw_invalid_price_mode");
  const tier = input.priceMode === "wholesale"
    ? [...input.tiers].sort((a,b) => b.minBaseUnits - a.minBaseUnits).find(t => t.minBaseUnits <= baseQuantity)
    : undefined;
  const unitPriceSatang = tier?.unitPriceSatang ?? input.retailPriceSatang;
  const lineTotalSatang = baseQuantity * unitPriceSatang;
  if (!validInt(lineTotalSatang, 0)) throw new Error("rw_total_overflow");
  return { baseQuantity, unitPriceSatang, lineTotalSatang, appliedTier: tier?.minBaseUnits ?? null };
}
