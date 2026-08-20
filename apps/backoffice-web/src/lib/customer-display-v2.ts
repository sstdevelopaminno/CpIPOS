export type CustomerDisplayV2Phase = "idle" | "cart" | "cash" | "qr" | "paid";
export type CustomerDisplayV2PaymentMethod = "cash" | "bank_transfer" | null;

export const CUSTOMER_DISPLAY_V2_IDLE_TIMEOUT_MS = 5 * 60_000;
export const CUSTOMER_DISPLAY_V2_PAID_VISIBLE_MS = 12_000;
export const CUSTOMER_DISPLAY_V2_ENABLED_KEY = "pos_customer_display_v2_enabled_v001";
export const CUSTOMER_DISPLAY_V2_PAYMENT_EVENT = "pos:customer-display-v2-payment";
export const CUSTOMER_DISPLAY_V2_PAYMENT_STORAGE_KEY = "pos_customer_display_v2_payment_v001";
export const CUSTOMER_DISPLAY_V2_LAST_ACTIVITY_KEY = "pos_customer_display_v2_last_activity_v001";

export type CustomerDisplayV2PaymentState = {
  phase: "cash" | "qr" | "paid";
  order_no?: string | null;
  total_amount?: number | null;
  cash_received?: number | null;
  change_amount?: number | null;
  payment_method?: CustomerDisplayV2PaymentMethod;
  payment_qr_url?: string | null;
  updated_at: string;
};

export type CustomerDisplayV2ItemPayload = {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string | null;
};

export type CustomerDisplayV2Payload = {
  version: 2;
  phase: CustomerDisplayV2Phase;
  store_name: string;
  store_logo_url: string | null;
  branch_name: string | null;
  device_id: string | null;
  device_code: string | null;
  device_name: string | null;
  order_no: string | null;
  items: CustomerDisplayV2ItemPayload[];
  total_amount: number;
  cash_received: number | null;
  change_amount: number | null;
  payment_method: CustomerDisplayV2PaymentMethod;
  payment_qr_url: string | null;
  media_urls: string[];
  last_activity_at: string;
  updated_at: string;
};

function channelPart(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 46);
}

export function buildCustomerDisplayV2Channel(device: {
  id?: string | null;
  code?: string | null;
}) {
  const identity = channelPart(device.id) || channelPart(device.code) || "default";
  return `pos-${identity}-display`.slice(0, 64);
}

export function resolveCustomerDisplayV2Phase(input: {
  nowMs: number;
  lastActivityAtMs: number;
  itemCount: number;
  paymentState?: CustomerDisplayV2PaymentState | null;
}): CustomerDisplayV2Phase {
  const paymentState = input.paymentState;
  if (paymentState?.phase === "paid") return "paid";
  if (paymentState?.phase === "qr") return "qr";
  if (paymentState?.phase === "cash") return "cash";
  if (input.itemCount > 0) return "cart";

  // An empty POS has no customer transaction to present. Keep the secondary
  // display on its stable idle brand immediately instead of rendering an empty
  // cart for up to five minutes and visually jumping away from the idle logo.
  return "idle";
}

export function readCustomerDisplayV2PaymentState(raw: string | null): CustomerDisplayV2PaymentState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as CustomerDisplayV2PaymentState;
    if (value.phase !== "cash" && value.phase !== "qr" && value.phase !== "paid") return null;
    if (!value.updated_at) return null;
    return value;
  } catch {
    return null;
  }
}
