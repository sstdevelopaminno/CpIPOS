export type PosBuffetPricingMode = "per_person" | "set";

export type PosBuffetPricePlan = {
  id: string;
  product_id?: string | null;
  code: string;
  name: string;
  mode: PosBuffetPricingMode;
  price: number;
  is_active: boolean;
  configured?: boolean;
  draft?: boolean;
  item_count?: number;
  description?: string | null;
};

export type PosBuffetCartItem = {
  cart_line_id: string;
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string | null;
};

export const DEFAULT_BUFFET_PRICE_PLANS: PosBuffetPricePlan[] = [
  {
    id: "buffet-per-person-standard",
    product_id: null,
    code: "BUFFET-PER-PERSON",
    name: "บุฟเฟ่รายท่าน",
    mode: "per_person",
    price: 199,
    is_active: true,
    configured: false,
    draft: false,
    item_count: 0,
    description: "คิดราคาต่อจำนวนลูกค้า"
  },
  {
    id: "buffet-set-standard",
    product_id: null,
    code: "BUFFET-SET",
    name: "บุฟเฟ่แบบชุด",
    mode: "set",
    price: 599,
    is_active: true,
    configured: false,
    draft: false,
    item_count: 0,
    description: "คิดราคาตามจำนวนชุด"
  }
];

export function normalizeBuffetQuantity(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(999, Math.max(1, Math.trunc(parsed)));
}

/** Legacy helper kept for compatibility with older UI/tests. New Buffet Table UI uses exact quick quantities. */
export function appendBuffetQuantityKey(current: string, key: string, replaceCurrent = false): string {
  const normalizedKey = String(key ?? "").replace(/[^0-9]/g, "");
  if (!normalizedKey) return String(current ?? "").replace(/[^0-9]/g, "").slice(0, 3);
  const raw = `${replaceCurrent ? "" : String(current ?? "")}${normalizedKey}`.replace(/[^0-9]/g, "");
  const normalized = raw.replace(/^0+(?=\d)/u, "");
  return normalized.slice(0, 3);
}

export function selectBuffetQuickQuantity(value: number | string): number {
  return normalizeBuffetQuantity(value);
}

export function adjustBuffetQuantity(current: number | string, delta: number): number {
  const normalized = normalizeBuffetQuantity(current);
  const safeDelta = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  return Math.min(999, Math.max(1, normalized + safeDelta));
}

export function buildBuffetCartItem(args: {
  plan: PosBuffetPricePlan;
  quantity: number | string;
  tableCode?: string | null;
}): PosBuffetCartItem {
  const quantity = normalizeBuffetQuantity(args.quantity);
  const tableCode = String(args.tableCode ?? "").trim();
  const modeLabel = args.plan.mode === "per_person" ? "รายท่าน" : "แบบชุด";
  return {
    cart_line_id: `buffet-${args.plan.id}-${Date.now()}`,
    product_id: args.plan.product_id || `BUFFET:${args.plan.id}`,
    name: args.plan.name,
    quantity,
    price: Number(args.plan.price || 0),
    notes: ["บุฟเฟ่", modeLabel, tableCode ? `โต๊ะ ${tableCode}` : ""].filter(Boolean).join(" / ")
  };
}

export function calculateBuffetPlanTotal(plan: PosBuffetPricePlan, quantity: number | string): number {
  return Number((Number(plan.price || 0) * normalizeBuffetQuantity(quantity)).toFixed(2));
}
