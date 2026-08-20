"use client";

import { useEffect, useRef } from "react";
import {
  buildCustomerDisplayV2Channel,
  CUSTOMER_DISPLAY_V2_ENABLED_KEY,
  CUSTOMER_DISPLAY_V2_IDLE_TIMEOUT_MS,
  CUSTOMER_DISPLAY_V2_LAST_ACTIVITY_KEY,
  CUSTOMER_DISPLAY_V2_PAID_VISIBLE_MS,
  CUSTOMER_DISPLAY_V2_PAYMENT_EVENT,
  CUSTOMER_DISPLAY_V2_PAYMENT_STORAGE_KEY,
  readCustomerDisplayV2PaymentState,
  resolveCustomerDisplayV2Phase,
  type CustomerDisplayV2Payload,
  type CustomerDisplayV2PaymentState
} from "@/lib/customer-display-v2";

const CART_KEY = "pos_sales_cart_v012";
const SALES_SNAPSHOT_KEY = "pos_sales_snapshot_v001";
const ACTIVE_ORDER_KEY = "pos_active_order_v001";
const OPEN_PAYMENT_STALE_MS = 2 * 60_000;
const LOCAL_STATE_SCAN_MS = 500;
const STATIC_CONTEXT_REFRESH_MS = 5_000;
const PUBLISH_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 15_000] as const;

type CartItem = {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string | null;
};

type SalesSnapshot = {
  tenant_id?: string | null;
  branch_id?: string | null;
  branch_name?: string | null;
  operator_name?: string | null;
  store_profile?: {
    display_name?: string | null;
    name?: string | null;
    logo_url?: string | null;
  } | null;
  device_policy?: {
    id?: string | null;
    code?: string | null;
    name?: string | null;
  } | null;
};

type ActiveOrder = {
  order_no?: string | null;
};

type PricingSummary = {
  subtotal_amount: number;
  discount_amount: number;
  total_amount: number;
};

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function normalizeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(2));
}

function parseMoneyText(value: string | null | undefined) {
  const normalized = String(value ?? "").replace(/,/g, "");
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPosPricingSummary(cartSubtotal: number): PricingSummary {
  const fallback = {
    subtotal_amount: roundMoney(cartSubtotal),
    discount_amount: 0,
    total_amount: roundMoney(cartSubtotal)
  };
  const card = document.querySelector<HTMLElement>(".posui-bill-summary-card");
  if (!card) return fallback;

  const rows = Array.from(card.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement && node.tagName === "P"
  );
  const totalRow = rows.find((row) => row.classList.contains("is-total"));
  const displayedTotal = parseMoneyText(totalRow?.querySelector("strong")?.textContent);
  if (displayedTotal == null) return fallback;

  const totalIndex = totalRow ? rows.indexOf(totalRow) : -1;
  const subtotalIndex = rows.findIndex((row, index) => {
    if (totalIndex >= 0 && index >= totalIndex) return false;
    const strongText = row.querySelector("strong")?.textContent ?? "";
    if (!strongText.includes("฿")) return false;
    const value = parseMoneyText(strongText);
    return value != null && Math.abs(value - cartSubtotal) < 0.011;
  });

  let signedTaxTotal = 0;
  if (subtotalIndex >= 0 && totalIndex > subtotalIndex) {
    for (const row of rows.slice(subtotalIndex + 1, totalIndex)) {
      const strongText = row.querySelector("strong")?.textContent ?? "";
      if (!strongText.includes("฿")) continue;
      const value = parseMoneyText(strongText);
      if (value == null) continue;
      signedTaxTotal += /^\s*-/.test(strongText) ? -Math.abs(value) : Math.abs(value);
    }
  }

  const totalAmount = roundMoney(displayedTotal);
  const discountAmount = roundMoney(Math.max(0, cartSubtotal + signedTaxTotal - totalAmount));
  return {
    subtotal_amount: roundMoney(cartSubtotal),
    discount_amount: discountAmount,
    total_amount: totalAmount
  };
}

function imageFingerprint(value: string | null | undefined) {
  const source = String(value ?? "");
  if (!source) return "";
  return `${source.length}:${source.slice(0, 48)}:${source.slice(-48)}`;
}

function readLastActivityAt() {
  const stored = Number(window.localStorage.getItem(CUSTOMER_DISPLAY_V2_LAST_ACTIVITY_KEY));
  if (Number.isFinite(stored) && stored > 0) return stored;
  return Date.now() - CUSTOMER_DISPLAY_V2_IDLE_TIMEOUT_MS;
}

function rememberActivity(atMs = Date.now()) {
  window.localStorage.setItem(CUSTOMER_DISPLAY_V2_LAST_ACTIVITY_KEY, String(atMs));
  return atMs;
}

function readFreshPaymentState(nowMs: number) {
  const state = readCustomerDisplayV2PaymentState(window.localStorage.getItem(CUSTOMER_DISPLAY_V2_PAYMENT_STORAGE_KEY));
  if (!state) return null;
  const updatedAtMs = new Date(state.updated_at).getTime();
  if (!Number.isFinite(updatedAtMs)) return null;
  const maxAge = state.phase === "paid" ? CUSTOMER_DISPLAY_V2_PAID_VISIBLE_MS : OPEN_PAYMENT_STALE_MS;
  if (nowMs - updatedAtMs > maxAge) {
    window.localStorage.removeItem(CUSTOMER_DISPLAY_V2_PAYMENT_STORAGE_KEY);
    return null;
  }
  return state;
}

export function PosCustomerDisplayV2Publisher() {
  const timerRef = useRef<number | null>(null);
  const publishedSignatureRef = useRef("");
  const inFlightRef = useRef(false);
  const pendingRef = useRef<{ payload: CustomerDisplayV2Payload; signature: string } | null>(null);
  const previousCartSignatureRef = useRef<string | null>(null);
  const previousPricingSignatureRef = useRef<string | null>(null);
  const previousPaymentSignatureRef = useRef<string | null>(null);
  const publishFailureCountRef = useRef(0);
  const publishRetryNotBeforeRef = useRef(0);
  const snapshotCacheRef = useRef<SalesSnapshot | null>(null);
  const snapshotReadAtRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    const publish = (payload: CustomerDisplayV2Payload, signature: string) => {
      if (disposed) return;
      if (Date.now() < publishRetryNotBeforeRef.current) {
        pendingRef.current = { payload, signature };
        return;
      }
      if (publishedSignatureRef.current === signature && !inFlightRef.current) return;
      if (inFlightRef.current) {
        pendingRef.current = { payload, signature };
        return;
      }

      inFlightRef.current = true;
      publishedSignatureRef.current = signature;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 4000);
      void fetch("/api/pos/customer-display/v2/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
        keepalive: true,
        signal: controller.signal
      })
        .then((response) => {
          if (!response.ok) throw new Error(`customer_display_v2_publish_${response.status}`);
          publishFailureCountRef.current = 0;
          publishRetryNotBeforeRef.current = 0;
        })
        .catch(() => {
          if (publishedSignatureRef.current === signature) {
            publishedSignatureRef.current = "";
          }
          const failureIndex = Math.min(publishFailureCountRef.current, PUBLISH_RETRY_DELAYS_MS.length - 1);
          publishFailureCountRef.current += 1;
          publishRetryNotBeforeRef.current = Date.now() + PUBLISH_RETRY_DELAYS_MS[failureIndex];
        })
        .finally(() => {
          window.clearTimeout(timeoutId);
          inFlightRef.current = false;
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (pending && pending.signature !== publishedSignatureRef.current) {
            publish(pending.payload, pending.signature);
          }
        });
    };

    const buildAndPublish = () => {
      if (disposed) return;
      if (window.localStorage.getItem(CUSTOMER_DISPLAY_V2_ENABLED_KEY) !== "1") return;

      const nowMs = Date.now();
      const cart = readJson<CartItem[]>(CART_KEY) ?? [];
      const activeOrder = readJson<ActiveOrder>(ACTIVE_ORDER_KEY);
      if (!snapshotCacheRef.current || nowMs - snapshotReadAtRef.current >= STATIC_CONTEXT_REFRESH_MS) {
        snapshotCacheRef.current = readJson<SalesSnapshot>(SALES_SNAPSHOT_KEY);
        snapshotReadAtRef.current = nowMs;
      }
      const snapshot = snapshotCacheRef.current;
      const device = snapshot?.device_policy ?? null;
      const cartSignature = JSON.stringify(cart.map((item) => [item.product_id, item.name, item.quantity, item.price, item.notes ?? null]));
      let lastActivityAtMs = readLastActivityAt();

      if (previousCartSignatureRef.current === null) {
        previousCartSignatureRef.current = cartSignature;
      } else if (cartSignature !== previousCartSignatureRef.current) {
        previousCartSignatureRef.current = cartSignature;
        lastActivityAtMs = rememberActivity(nowMs);
      }

      const totalFromCart = roundMoney(cart.reduce((sum, item) => sum + normalizeNumber(item.quantity) * normalizeNumber(item.price), 0));
      const pricing = readPosPricingSummary(totalFromCart);
      const pricingSignature = JSON.stringify(pricing);
      if (previousPricingSignatureRef.current === null) {
        previousPricingSignatureRef.current = pricingSignature;
      } else if (pricingSignature !== previousPricingSignatureRef.current) {
        previousPricingSignatureRef.current = pricingSignature;
        lastActivityAtMs = rememberActivity(nowMs);
      }

      const paymentState = readFreshPaymentState(nowMs);
      const paymentSignature = paymentState
        ? JSON.stringify({ ...paymentState, updated_at: undefined })
        : "none";
      if (previousPaymentSignatureRef.current === null) {
        previousPaymentSignatureRef.current = paymentSignature;
      } else if (paymentSignature !== previousPaymentSignatureRef.current) {
        previousPaymentSignatureRef.current = paymentSignature;
        lastActivityAtMs = rememberActivity(nowMs);
      }

      const hasPaymentTotal = paymentState?.total_amount != null && Number.isFinite(Number(paymentState.total_amount));
      const totalAmount = hasPaymentTotal ? roundMoney(normalizeNumber(paymentState?.total_amount)) : pricing.total_amount;
      const itemCount = cart.reduce((sum, item) => sum + normalizeNumber(item.quantity), 0);
      const phase = resolveCustomerDisplayV2Phase({
        nowMs,
        lastActivityAtMs,
        itemCount,
        paymentState
      });
      const storeName = String(snapshot?.store_profile?.display_name ?? snapshot?.store_profile?.name ?? "CpIPOS").trim() || "CpIPOS";
      const payload: CustomerDisplayV2Payload = {
        version: 2,
        phase,
        store_name: storeName,
        store_logo_url: String(snapshot?.store_profile?.logo_url ?? "").trim() || null,
        branch_name: String(snapshot?.branch_name ?? "").trim() || null,
        device_id: String(device?.id ?? "").trim() || null,
        device_code: String(device?.code ?? "").trim() || null,
        device_name: String(device?.name ?? device?.code ?? "").trim() || null,
        order_no: String(paymentState?.order_no ?? activeOrder?.order_no ?? "").trim() || null,
        items: cart.map((item) => ({
          product_id: String(item.product_id),
          name: String(item.name),
          quantity: normalizeNumber(item.quantity),
          price: normalizeNumber(item.price),
          notes: item.notes ?? null
        })),
        subtotal_amount: pricing.subtotal_amount,
        discount_amount: pricing.discount_amount,
        total_amount: totalAmount,
        cash_received: paymentState?.cash_received == null ? null : normalizeNumber(paymentState.cash_received),
        change_amount: paymentState?.change_amount == null ? null : normalizeNumber(paymentState.change_amount),
        payment_method: paymentState?.payment_method ?? null,
        payment_qr_url: String(paymentState?.payment_qr_url ?? "").trim() || null,
        media_urls: [],
        last_activity_at: new Date(lastActivityAtMs).toISOString(),
        updated_at: new Date(nowMs).toISOString()
      };
      const signature = JSON.stringify({
        version: payload.version,
        phase: payload.phase,
        store_name: payload.store_name,
        store_logo: imageFingerprint(payload.store_logo_url),
        branch_name: payload.branch_name,
        device_id: payload.device_id,
        device_code: payload.device_code,
        device_name: payload.device_name,
        order_no: payload.order_no,
        items: payload.items,
        subtotal_amount: payload.subtotal_amount,
        discount_amount: payload.discount_amount,
        total_amount: payload.total_amount,
        cash_received: payload.cash_received,
        change_amount: payload.change_amount,
        payment_method: payload.payment_method,
        payment_qr: imageFingerprint(payload.payment_qr_url),
        media: payload.media_urls.map(imageFingerprint),
        last_activity_at: payload.last_activity_at,
        expected_channel: buildCustomerDisplayV2Channel({ id: device?.id, code: device?.code })
      });
      publish(payload, signature);
    };

    const schedule = (delay = 120) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(buildAndPublish, delay);
    };

    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (event.key === SALES_SNAPSHOT_KEY) {
        snapshotReadAtRef.current = 0;
      }
      if (
        event.key === CART_KEY ||
        event.key === SALES_SNAPSHOT_KEY ||
        event.key === ACTIVE_ORDER_KEY ||
        event.key === CUSTOMER_DISPLAY_V2_ENABLED_KEY ||
        event.key === CUSTOMER_DISPLAY_V2_PAYMENT_STORAGE_KEY
      ) {
        schedule();
      }
    };

    const onPayment = (event: Event) => {
      const detail = (event as CustomEvent<CustomerDisplayV2PaymentState | null>).detail;
      if (!detail) {
        window.localStorage.removeItem(CUSTOMER_DISPLAY_V2_PAYMENT_STORAGE_KEY);
      } else {
        window.localStorage.setItem(CUSTOMER_DISPLAY_V2_PAYMENT_STORAGE_KEY, JSON.stringify(detail));
        rememberActivity();
      }
      schedule(0);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(CUSTOMER_DISPLAY_V2_PAYMENT_EVENT, onPayment as EventListener);
    schedule(0);

    // Same-tab localStorage writes do not emit `storage`. Scan small local transaction
    // state every 500 ms and read the already-rendered POS bill summary for the current
    // net total. Signature dedupe prevents unchanged scans from becoming network polling.
    const stateScanTimer = window.setInterval(() => schedule(0), LOCAL_STATE_SCAN_MS);

    return () => {
      disposed = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      window.clearInterval(stateScanTimer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CUSTOMER_DISPLAY_V2_PAYMENT_EVENT, onPayment as EventListener);
      pendingRef.current = null;
    };
  }, []);

  return null;
}
