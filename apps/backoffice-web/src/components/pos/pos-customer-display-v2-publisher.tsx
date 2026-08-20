"use client";

import { useEffect, useRef } from "react";
import {
  buildCustomerDisplayV2Channel,
  CUSTOMER_DISPLAY_V2_IDLE_TIMEOUT_MS,
  CUSTOMER_DISPLAY_V2_LAST_ACTIVITY_KEY,
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
const PAID_VISIBLE_MS = 12_000;
const OPEN_PAYMENT_STALE_MS = 2 * 60_000;
const LOCAL_STATE_SCAN_MS = 500;

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
  const maxAge = state.phase === "paid" ? PAID_VISIBLE_MS : OPEN_PAYMENT_STALE_MS;
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
  const pendingRef = useRef<{ payload: CustomerDisplayV2Payload; channel: string; signature: string } | null>(null);
  const previousCartSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    let disposed = false;

    const publish = (payload: CustomerDisplayV2Payload, channel: string, signature: string) => {
      if (disposed) return;
      if (publishedSignatureRef.current === signature && !inFlightRef.current) return;
      if (inFlightRef.current) {
        pendingRef.current = { payload, channel, signature };
        return;
      }

      inFlightRef.current = true;
      publishedSignatureRef.current = signature;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 4000);
      void fetch("/api/pos/customer-display", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, payload }),
        keepalive: true,
        signal: controller.signal
      })
        .catch(() => undefined)
        .finally(() => {
          window.clearTimeout(timeoutId);
          inFlightRef.current = false;
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (pending && pending.signature !== publishedSignatureRef.current) {
            publish(pending.payload, pending.channel, pending.signature);
          }
        });
    };

    const buildAndPublish = () => {
      if (disposed) return;
      const cart = readJson<CartItem[]>(CART_KEY) ?? [];
      const snapshot = readJson<SalesSnapshot>(SALES_SNAPSHOT_KEY);
      const activeOrder = readJson<ActiveOrder>(ACTIVE_ORDER_KEY);
      const device = snapshot?.device_policy ?? null;
      const channel = buildCustomerDisplayV2Channel({ id: device?.id, code: device?.code });
      const nowMs = Date.now();
      const cartSignature = JSON.stringify(cart.map((item) => [item.product_id, item.name, item.quantity, item.price, item.notes ?? null]));
      let lastActivityAtMs = readLastActivityAt();

      if (previousCartSignatureRef.current === null) {
        previousCartSignatureRef.current = cartSignature;
      } else if (cartSignature !== previousCartSignatureRef.current) {
        previousCartSignatureRef.current = cartSignature;
        lastActivityAtMs = rememberActivity(nowMs);
      }

      const paymentState = readFreshPaymentState(nowMs);
      if (paymentState) lastActivityAtMs = rememberActivity(nowMs);

      const totalFromCart = Number(cart.reduce((sum, item) => sum + normalizeNumber(item.quantity) * normalizeNumber(item.price), 0).toFixed(2));
      const paymentTotal = normalizeNumber(paymentState?.total_amount);
      const totalAmount = paymentTotal > 0 ? paymentTotal : totalFromCart;
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
        total_amount: totalAmount,
        cash_received: paymentState?.cash_received == null ? null : normalizeNumber(paymentState.cash_received),
        change_amount: paymentState?.change_amount == null ? null : normalizeNumber(paymentState.change_amount),
        payment_method: paymentState?.payment_method ?? null,
        payment_qr_url: String(paymentState?.payment_qr_url ?? "").trim() || null,
        media_urls: [],
        last_activity_at: new Date(lastActivityAtMs).toISOString(),
        updated_at: new Date(nowMs).toISOString()
      };
      const { updated_at: _ignored, ...stable } = payload;
      const signature = JSON.stringify(stable);
      publish(payload, channel, signature);
    };

    const schedule = (delay = 120) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(buildAndPublish, delay);
    };

    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (
        event.key === CART_KEY ||
        event.key === SALES_SNAPSHOT_KEY ||
        event.key === ACTIVE_ORDER_KEY ||
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

    // Browser `storage` events do not fire in the tab that performed the write.
    // Scan only local state at low cost; `publish()` still dedupes by stable
    // payload signature so unchanged scans do not create network requests.
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
