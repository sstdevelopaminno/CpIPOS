import { isCustomRecyclingUnit, priceUnitLabel } from "@/lib/recycling-price-units";
import type { RecyclingPriceBasis, RecyclingUnit } from "@/lib/server/recycling-pos-service";

const KG_MULTIPLIER: Record<"ton"|"kg"|"khid"|"g", number> = {
  ton: 1000,
  kg: 1,
  khid: 0.1,
  g: 0.001
};

const MICRO_KG = 1_000_000;
const MAX_BASE_QUANTITY = 100_000_000;
const MAX_AMOUNT_MINOR = 99_999_999_999_999n;

export function recyclingUnitLabel(unit: RecyclingUnit): string {
  return unit==="ton"?"ตัน":unit==="stem"?"ต้น":priceUnitLabel(unit);
}

/**
 * Exact half-up baht rounding from integer satang and micro-kilograms.
 * Mirrors PostgreSQL round(numeric) in recycling_post_transaction so
 * the preview never uses imprecise floating-point baht multiplication.
 * Real validation and stock updates are always performed on the server.
 */
export function calculateRecyclingLine(
  quantity: number,
  unit: RecyclingUnit,
  price: number,
  priceBasis: RecyclingPriceBasis
): { amount: number; basisQuantity: number } | null {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) ||
      price < 0 || price > 99_999_999) return null;
  const countBased = isCustomRecyclingUnit(unit) || unit === "piece" || unit === "stem" || unit === "carton" || unit === "vehicle" || unit === "set" || unit === "unit" || unit === "machine" || unit === "cabinet";
  if ((priceBasis === "piece") !== countBased) return null;
  const priceCentsFloat = price * 100;
  const priceCents = Math.round(priceCentsFloat);
  if (!Number.isSafeInteger(priceCents) || Math.abs(priceCentsFloat - priceCents) > 1e-6) return null;

  let basisQuantity: number;
  let amountMinor: bigint;
  if (countBased) {
    if (!Number.isSafeInteger(quantity) || quantity > MAX_BASE_QUANTITY) return null;
    basisQuantity = quantity;
    amountMinor = BigInt(priceCents) * BigInt(quantity);
  } else {
    const kg = quantity * KG_MULTIPLIER[unit as keyof typeof KG_MULTIPLIER];
    if (!Number.isFinite(kg) || kg < 0.001 || kg > MAX_BASE_QUANTITY) return null;
    const microKgFloat = kg * MICRO_KG;
    const microKg = Math.round(microKgFloat);
    if (!Number.isSafeInteger(microKg) || Math.abs(microKgFloat - microKg) > 1e-5) return null;
    basisQuantity = microKg / MICRO_KG;
    // All values are nonnegative. +half divisor implements numeric ROUND.
    amountMinor = (BigInt(priceCents) * BigInt(microKg) + 500_000n) / 1_000_000n;
  }
  if (amountMinor <= 0n || amountMinor > MAX_AMOUNT_MINOR) return null;
  return { amount: Number(amountMinor) / 100, basisQuantity };
}
