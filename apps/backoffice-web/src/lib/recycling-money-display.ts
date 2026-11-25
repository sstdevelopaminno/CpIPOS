import { formatRecyclingUnitPrice, type RecyclingPriceUnit } from "./recycling-price-units";

/** Display-only THB formatting. Never use formatted strings for arithmetic or form inputs. */
const moneyFormatter = new Intl.NumberFormat("th-TH", {
  numberingSystem: "latn", useGrouping: true,
  minimumFractionDigits: 2, maximumFractionDigits: 2
});

export function formatRecyclingMoney(value: unknown, fallback = "—"): string {
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  if (typeof value === "string" && !value.trim()) return fallback;
  const amount = Number(value);
  return Number.isFinite(amount) ? moneyFormatter.format(amount) : fallback;
}

export function formatRecyclingUnitPriceDisplay(price: number | null | undefined, unit: RecyclingPriceUnit): string {
  const raw = formatRecyclingUnitPrice(price, unit);
  if (!raw) return "";
  const [whole, fraction = ""] = raw.split(".");
  return Number(whole).toLocaleString("en-US") + "." + fraction.padEnd(2, "0");
}
