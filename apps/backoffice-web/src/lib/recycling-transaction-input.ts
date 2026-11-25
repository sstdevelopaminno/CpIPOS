type TxLine = {
  product_id: string;
  unit: string;
  quantity: number;
  expected_price: number;
};

const VALID_UNITS = new Set(["kg", "khid", "g", "ton", "piece", "stem", "carton"]);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export function readLine(value: unknown): TxLine | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const line = value as Record<string, unknown>;
  if (typeof line.product_id !== "string" || !UUID.test(line.product_id) ||
      typeof line.unit !== "string" || !VALID_UNITS.has(line.unit)) return null;
  // Do not coerce null, booleans, arrays, objects, or non-decimal strings.
  const qty = readDecimal(line.quantity, /^\d{1,10}(\.\d{1,6})?$/);
  const price = readDecimal(line.expected_price, MONEY_PATTERN);
  if (qty === null || price === null) return null;
  if (!Number.isFinite(qty) || qty <= 0 || qty > 100000000 ||
      !Number.isFinite(price) || price < 0 || price > 99999999 ||
      !MONEY_PATTERN.test(String(price))) return null;
  // Limit precision to six decimal places. One gram equals 0.001 kg.
  if (!/^\d{1,10}(\.\d{1,6})?$/.test(String(qty))) return null;
  if ((line.unit === "piece" || line.unit === "stem" || line.unit === "carton") && !Number.isInteger(qty)) return null;
  return { product_id: line.product_id, unit: line.unit, quantity: qty, expected_price: price };
}

function readDecimal(value: unknown, pattern: RegExp): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (!pattern.test(String(value))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isRecyclingDirection(value: unknown): value is "buy" | "sell" {
  return value === "buy" || value === "sell";
}
export function isRecyclingSettlement(value: unknown): value is "cash" | "bank_transfer" | "credit" {
  return value === "cash" || value === "bank_transfer" || value === "credit";
}
