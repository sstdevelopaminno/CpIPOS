"use client";

import { useEffect, useMemo, useState } from "react";
import { PosCustomerDisplayV2Screen, type CustomerDisplayV2ScreenState } from "@/components/pos/pos-customer-display-v2-screen";
import type { CustomerDisplayV2Payload } from "@/lib/customer-display-v2";
import type { Language } from "@/lib/i18n";

type NativeStateResponse = {
  data?: {
    data?: {
      payload?: CustomerDisplayV2Payload | Record<string, unknown>;
      updated_at?: string;
    } | null;
  } | null;
};

const NATIVE_STATE_CLIENT_TIMEOUT_MS = 4_000;

function emptyIdleState(): CustomerDisplayV2ScreenState {
  return {
    phase: "idle",
    store_name: "CpIPOS",
    store_logo_url: null,
    branch_name: null,
    device_name: null,
    order_no: null,
    items: [],
    subtotal_amount: 0,
    discount_amount: 0,
    total_amount: 0,
    cash_received: null,
    change_amount: null,
    payment_qr_url: null,
    media_urls: []
  };
}

function toScreenState(payload: CustomerDisplayV2Payload): CustomerDisplayV2ScreenState {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const forcedIdle = payload.phase === "cart" && items.length === 0;

  return {
    phase: forcedIdle ? "idle" : payload.phase,
    store_name: payload.store_name || "CpIPOS",
    store_logo_url: payload.store_logo_url,
    branch_name: payload.branch_name,
    device_name: payload.device_name,
    order_no: payload.order_no,
    items,
    subtotal_amount: Number(payload.subtotal_amount ?? 0),
    discount_amount: Number(payload.discount_amount ?? 0),
    total_amount: Number(payload.total_amount ?? 0),
    cash_received: payload.cash_received,
    change_amount: payload.change_amount,
    payment_qr_url: payload.payment_qr_url,
    media_urls: Array.isArray(payload.media_urls) ? payload.media_urls : []
  };
}

export function PosCustomerDisplayV2Native({ lang }: { lang: Language }) {
  const [payload, setPayload] = useState<CustomerDisplayV2Payload | null>(null);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;

    const sync = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), NATIVE_STATE_CLIENT_TIMEOUT_MS);
      try {
        const response = await fetch("/api/pos/customer-display/v2/native-state", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal
        });
        if (response.status === 401 || response.status === 403 || response.status === 409) {
          if (!disposed) setPayload(null);
          return;
        }
        if (!response.ok) return;
        const body = (await response.json()) as NativeStateResponse;
        const next = body.data?.data?.payload as CustomerDisplayV2Payload | undefined;
        if (!next || next.version !== 2) {
          if (!disposed) setPayload(null);
          return;
        }
        if (!disposed) setPayload(next);
      } catch {
        // Preserve the latest customer-visible state during short network interruptions.
      } finally {
        window.clearTimeout(timeoutId);
        inFlight = false;
      }
    };

    void sync();
    const timer = window.setInterval(() => void sync(), 1_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const screenState = useMemo(() => (payload ? toScreenState(payload) : emptyIdleState()), [payload]);
  const hideCashRowsForTransferPaid = payload?.phase === "paid" && payload.payment_method === "bank_transfer";

  return (
    <div
      data-cdv2-native="1"
      data-cdv2-transfer-paid={hideCashRowsForTransferPaid ? "1" : "0"}
      style={{ width: "100vw", height: "100dvh", minHeight: "100vh", overflow: "hidden", overscrollBehavior: "none" }}
    >
      <style>{`
        [data-cdv2-native="1"],
        [data-cdv2-native="1"] .cdv2-screen {
          width: 100% !important;
          height: 100% !important;
          min-height: 0 !important;
          overflow: hidden !important;
          overscroll-behavior: none;
        }

        @media (orientation: landscape) {
          [data-cdv2-native="1"] .cdv2-layout {
            grid-template-columns: minmax(0, 1.55fr) minmax(180px, .75fr) !important;
            grid-template-rows: minmax(0, 1fr) !important;
          }
          [data-cdv2-native="1"] .cdv2-transaction {
            border-right: 1px solid #dbe3ec !important;
            border-bottom: 0 !important;
          }
          [data-cdv2-native="1"] .cdv2-media {
            padding: clamp(10px, 2vw, 22px) !important;
          }
          [data-cdv2-native="1"] .cdv2-qr-block {
            gap: clamp(6px, 1.4vh, 14px) !important;
          }
          [data-cdv2-native="1"] .cdv2-qr-img,
          [data-cdv2-native="1"] .cdv2-qr-placeholder {
            width: min(72%, 42vh, 260px) !important;
            max-height: 52vh;
          }
          [data-cdv2-native="1"] .cdv2-qr-amount {
            font-size: clamp(25px, 3.25vw, 48px) !important;
          }
          [data-cdv2-native="1"] .cdv2-powered {
            display: block !important;
          }
        }

        @media (orientation: landscape) and (max-width: 620px) {
          [data-cdv2-native="1"] .cdv2-layout {
            grid-template-columns: minmax(0, 1.62fr) minmax(150px, .72fr) !important;
          }
          [data-cdv2-native="1"] .cdv2-header {
            padding: 10px 12px !important;
          }
          [data-cdv2-native="1"] .cdv2-summary {
            padding: 9px 12px !important;
          }
        }
      `}</style>
      {hideCashRowsForTransferPaid ? (
        <style>{`[data-cdv2-transfer-paid="1"] .cdv2-cash-detail { display: none; }`}</style>
      ) : null}
      <PosCustomerDisplayV2Screen lang={lang} state={screenState} />
    </div>
  );
}
