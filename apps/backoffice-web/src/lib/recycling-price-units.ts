/**
 * CUSTOM Recycling may quote prices per kilogram, khid (100 g) or gram.
 * The transactional ledger and balance always use THB/kg and kilograms.
 * Price conversions use integer satang arithmetic and never approximate.
 */
export type RecyclingPriceUnit = "kg" | "khid" | "g" | "piece" | "carton" | "vehicle" | "set" | "unit" | "machine" | "cabinet";
export const RECYCLING_PRICE_UNIT_LABELS: Record<RecyclingPriceUnit, string> = {
  kg: "กิโลกรัม", khid: "ขีด", g: "กรัม", piece: "ชิ้น", carton: "ลัง", vehicle: "คัน", set: "ชุด", unit: "ตัว", machine: "เครื่อง", cabinet: "ตู้"
};
const CANONICAL_CENTS_PER_INPUT_UNIT: Record<RecyclingPriceUnit, bigint> = {
  kg: 100n, khid: 1_000n, g: 100_000n, piece: 100n, carton: 100n, vehicle: 100n, set: 100n, unit: 100n, machine: 100n, cabinet: 100n
};
const PRICE_DECIMALS: Record<RecyclingPriceUnit, number> = {
  kg: 2, khid: 3, g: 5, piece: 2, carton: 2, vehicle: 2, set: 2, unit: 2, machine: 2, cabinet: 2
};
const MAX_CENTS = 9_999_999_900n;

export function isRecyclingPriceUnit(raw: unknown): raw is RecyclingPriceUnit {
  return typeof raw === "string" && Object.prototype.hasOwnProperty.call(RECYCLING_PRICE_UNIT_LABELS, raw);
}
export function getRecyclingPriceBasis(unit: RecyclingPriceUnit): "kg" | "piece" {
  return unit === "kg" || unit === "khid" || unit === "g" ? "kg" : "piece";
}
export function parseRecyclingUnitPrice(raw: unknown, unit: RecyclingPriceUnit): number | null {
  if (!isRecyclingPriceUnit(unit) || (typeof raw !== "number" && typeof raw !== "string")) return null;
  const match = /^(\d{1,8})(?:\.(\d{1,5}))?$/.exec(String(raw).trim());
  if (!match) return null;
  const decimal = match[2] ?? "";
  if (decimal.length > PRICE_DECIMALS[unit]) return null;
  const factor = 10n ** BigInt(decimal.length);
  const amount = BigInt(match[1]) * factor + BigInt(decimal || "0");
  const canonicalCents = amount * CANONICAL_CENTS_PER_INPUT_UNIT[unit];
  if (canonicalCents % factor !== 0n) return null; // never silently round
  const cents = canonicalCents / factor;
  if (cents > MAX_CENTS) return null;
  return Number(cents) / 100;
}
export function formatRecyclingUnitPrice(price: number | null | undefined, unit: RecyclingPriceUnit): string {
  if (price == null || !isRecyclingPriceUnit(unit) ||
      !Number.isFinite(price) || price < 0 || price > 99_999_999) return "";
  const cents = Math.round(price * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(price * 100 - cents) > 1e-5) return "";
  const divisor = CANONICAL_CENTS_PER_INPUT_UNIT[unit];
  const whole = BigInt(cents) / divisor;
  const fraction = (BigInt(cents) % divisor).toString().padStart(PRICE_DECIMALS[unit], "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}
