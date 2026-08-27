"use client";

import { useEffect, useRef } from "react";
import { shouldDisableNativeCustomerDisplayForDiagnostics, type NativeDisplayDiagnostics } from "@/lib/android-pos/native-device-policy";
import {
  CUSTOMER_DISPLAY_V2_ENABLED_KEY,
  CUSTOMER_DISPLAY_V2_PAID_VISIBLE_MS,
  CUSTOMER_DISPLAY_V2_PAYMENT_EVENT,
  CUSTOMER_DISPLAY_V2_PAYMENT_STORAGE_KEY,
  readCustomerDisplayV2PaymentState,
  type CustomerDisplayV2PaymentState
} from "@/lib/customer-display-v2";

type CpiposMdmBridge = {
  diagnosticsJson?: () => string;
};

function shouldSkipCustomerDisplayObserverForDevice() {
  try {
    const bridge = (window as typeof window & { CpiposMdm?: CpiposMdmBridge }).CpiposMdm;
    if (!bridge?.diagnosticsJson) return false;
    const diagnostics = JSON.parse(bridge.diagnosticsJson()) as NativeDisplayDiagnostics;
    return shouldDisableNativeCustomerDisplayForDiagnostics(diagnostics);
  } catch {
    return false;
  }
}

function parseMoneyText(value: string | null | undefined) {
  const normalized = String(value ?? "").replace(/,/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function readExistingPaymentState() {
  return readCustomerDisplayV2PaymentState(window.localStorage.getItem(CUSTOMER_DISPLAY_V2_PAYMENT_STORAGE_KEY));
}

function emitPaymentState(state: CustomerDisplayV2PaymentState | null) {
  window.dispatchEvent(new CustomEvent(CUSTOMER_DISPLAY_V2_PAYMENT_EVENT, { detail: state }));
}

export function PosCustomerDisplayV2PaymentObserver() {
  const lastSignatureRef = useRef("");

  useEffect(() => {
    // Single-display devices do not need to observe customer-display payment DOM state.
    if (shouldSkipCustomerDisplayObserverForDevice()) return;

    let disposed = false;
    let timer: number | null = null;
    let observer: MutationObserver | null = null;

    const inspect = () => {
      timer = null;
      if (disposed || window.localStorage.getItem(CUSTOMER_DISPLAY_V2_ENABLED_KEY) !== "1") return;
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const receipt = document.querySelector<HTMLElement>(".posui-payment-modal--receipt-final");
      const transfer = document.querySelector<HTMLElement>(".posui-payment-modal--transfer-qr-only");
      const cash = document.querySelector<HTMLElement>(".posui-payment-modal--cash");
      let next: CustomerDisplayV2PaymentState | null = null;

      if (receipt) {
        const existing = readExistingPaymentState();
        const receiptText = receipt.textContent?.toLowerCase() ?? "";
        const method = receiptText.includes("เน€เธเธดเธเธชเธ”") || receiptText.includes("cash")
          ? "cash"
          : existing?.payment_method ?? "bank_transfer";
        const rows = Array.from(receipt.querySelectorAll<HTMLElement>(".posui-receipt-card-preview__summary p"));
        const receivedRow = rows.find((row) => /เธฃเธฑเธเน€เธเธดเธ|cash received/i.test(row.textContent ?? ""));
        const changeRow = rows.find((row) => /เน€เธเธดเธเธ—เธญเธ|change/i.test(row.textContent ?? ""));
        const totalRow = rows.find((row) => /เธขเธญเธ”เธเธณเธฃเธฐ|total due|amount due/i.test(row.textContent ?? ""));
        next = {
          phase: "paid",
          order_no: existing?.order_no ?? null,
          total_amount: parseMoneyText(totalRow?.querySelector("strong")?.textContent) ?? existing?.total_amount ?? null,
          cash_received: parseMoneyText(receivedRow?.querySelector("strong")?.textContent) ?? existing?.cash_received ?? null,
          change_amount: parseMoneyText(changeRow?.querySelector("strong")?.textContent) ?? existing?.change_amount ?? null,
          payment_method: method,
          payment_qr_url: existing?.payment_qr_url ?? null,
          updated_at: nowIso
        };
      } else if (transfer) {
        const qr = transfer.querySelector<HTMLImageElement>("img.posui-transfer-qr-image");
        const amount = parseMoneyText(transfer.querySelector<HTMLElement>(".posui-transfer-amount-card strong")?.textContent);
        next = {
          phase: "qr",
          order_no: null,
          total_amount: amount,
          cash_received: null,
          change_amount: 0,
          payment_method: "bank_transfer",
          payment_qr_url: qr?.currentSrc || qr?.src || null,
          updated_at: nowIso
        };
      } else if (cash) {
        const due = parseMoneyText(cash.querySelector<HTMLElement>(".posui-cash-summary-row--due strong")?.textContent);
        const received = parseMoneyText(cash.querySelector<HTMLElement>(".posui-cash-summary-row--received strong")?.textContent);
        const accent = cash.querySelector<HTMLElement>(".posui-cash-summary-row--accent");
        const accentText = accent?.textContent ?? "";
        const change = /เน€เธเธดเธเธ—เธญเธ|change/i.test(accentText)
          ? parseMoneyText(accent?.querySelector("strong")?.textContent) ?? 0
          : 0;
        next = {
          phase: "cash",
          order_no: null,
          total_amount: due,
          cash_received: received,
          change_amount: change,
          payment_method: "cash",
          payment_qr_url: null,
          updated_at: nowIso
        };
      }

      if (!next) {
        const existing = readExistingPaymentState();
        if (existing?.phase === "paid") {
          const paidAtMs = new Date(existing.updated_at).getTime();
          if (Number.isFinite(paidAtMs) && nowMs - paidAtMs < CUSTOMER_DISPLAY_V2_PAID_VISIBLE_MS) {
            return;
          }
        }
      }

      const signature = next
        ? JSON.stringify({ ...next, updated_at: undefined })
        : "none";
      if (signature === lastSignatureRef.current) return;
      lastSignatureRef.current = signature;
      emitPaymentState(next);
    };

    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(inspect, 40);
    };

    const startObserverIfEnabled = () => {
      if (disposed || observer || window.localStorage.getItem(CUSTOMER_DISPLAY_V2_ENABLED_KEY) !== "1") return;
      observer = new MutationObserver(schedule);
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["src"]
      });
      schedule();
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === CUSTOMER_DISPLAY_V2_ENABLED_KEY) startObserverIfEnabled();
    };

    startObserverIfEnabled();
    window.addEventListener("storage", onStorage);
    const activationTimer = window.setInterval(startObserverIfEnabled, 1_000);

    return () => {
      disposed = true;
      observer?.disconnect();
      window.clearInterval(activationTimer);
      window.removeEventListener("storage", onStorage);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
