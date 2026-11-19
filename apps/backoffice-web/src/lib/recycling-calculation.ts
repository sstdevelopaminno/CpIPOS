import type { RecyclingPriceBasis, RecyclingUnit } from "@/lib/server/recycling-pos-service";

const KG_MULTIPLIER: Record<Exclude<RecyclingUnit, "piece">, number> = {
  ton: 1000,
  kg: 1,
  khid: 0.1,
  g: 0.001
};

export function recyclingUnitLabel(unit: RecyclingUnit): string {
  return { ton: "ตัน", kg: "กิโลกรัม", khid: "ขีด", g: "กรัม", piece: "ชิ้น" }[unit];
}

/** Pure UI estimate only. Final money and stock must be calculated server-side. */
export function calculateRecyclingLine(
  quantity: number,
  unit: RecyclingUnit,
  price: number,
  priceBasis: RecyclingPriceBasis
): { amount: number; basisQuantity: number } | null {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0) return null;
  if ((priceBasis === "piece") !== (unit === "piece")) return null;
  const basisQuantity = unit === "piece" ? quantity : quantity * KG_MULTIPLIER[unit];
  if (!Number.isFinite(basisQuantity) || basisQuantity <= 0) return null;
  if (unit === "piece" && !Number.isInteger(quantity)) return null;
  const amount = Math.round((basisQuantity * price + Number.EPSILON) * 100) / 100;
  if (!Number.isFinite(amount) || amount > 999999999999.99) return null;
  return { amount, basisQuantity };
}
