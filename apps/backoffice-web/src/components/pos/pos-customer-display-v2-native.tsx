"use client";

import { useEffect, useMemo, useState } from "react";
import { PosCustomerDisplayV2Screen, type CustomerDisplayV2ScreenState } from "@/components/pos/pos-customer-display-v2-screen";
import { CUSTOMER_DISPLAY_V2_IDLE_TIMEOUT_MS, type CustomerDisplayV2Payload } from "@/lib/customer-display-v2";
import type { Language } from "@/lib/i18n";

type NativeStateResponse = {
  data?: {
    data?: {
      payload?: CustomerDisplayV2Payload | Record<string, unknown>;
      updated_at?: string;
    } | null;
  } | null;
};

function emptyIdleState(): CustomerDisplayV2ScreenState {
  return {
    phase: "idle",
    store_name: "CpIPOS",
    store_logo_url: null,
    branch_name: null,
    device_name: null,
    order_no: null,
    items: [],
    total_amount: 0,
    cash_received: null,
    change_amount: null,
    payment_qr_url: null,
    media_urls: []
  };
}

function toScreenState(payload: CustomerDisplayV2Payload, nowMs: number): CustomerDisplayV2ScreenState {
  const activityMs = new Date(payload.last_activity_at || payload.updated_at).getTime();
  const forcedIdle =
    payload.phase !== "cash" &&
    payload.phase !== "qr" &&
    payload.phase !== "paid" &&
    payload.items.length === 0 &&
    Number.isFinite(activityMs) &&
    nowMs - activityMs >= CUSTOMER_DISPLAY_V2_IDLE_TIMEOUT_MS;

  return {
    phase: forcedIdle ? "idle" : payload.phase,
    store_name: payload.store_name || "CpIPOS",
    store_logo_url: payload.store_logo_url,
    branch_name: payload.branch_name,
    device_name: payload.device_name,
    order_no: payload.order_no,
    items: Array.isArray(payload.items) ? payload.items : [],
    total_amount: Number(payload.total_amount ?? 0),
    cash_received: payload.cash_received,
    change_amount: payload.change_amount,
    payment_qr_url: payload.payment_qr_url,
    media_urls: Array.isArray(payload.media_urls) ? payload.media_urls : []
  };
}

export function PosCustomerDisplayV2Native({ lang }: { lang: Language }) {
  const [payload, setPayload] = useState<CustomerDisplayV2Payload | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const clock = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;

    const sync = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/pos/customer-display/v2/native-state", {
          cache: "no-store",
          credentials: "same-origin"
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

  const screenState = useMemo(() => (payload ? toScreenState(payload, nowMs) : emptyIdleState()), [payload, nowMs]);
  const hideCashRowsForTransferPaid = payload?.phase === "paid" && payload.payment_method === "bank_transfer";

  return (
    <div
      data-cdv2-native="1"
      data-cdv2-transfer-paid={hideCashRowsForTransferPaid ? "1" : "0"}
      style={{ width: "100vw", height: "100dvh", minHeight: "100vh", overflow: "hidden" }}
    >
      {hideCashRowsForTransferPaid ? (
        <style>{`[data-cdv2-transfer-paid="1"] .cdv2-summary-line:nth-child(n+2) { display: none; }`}</style>
      ) : null}
      <PosCustomerDisplayV2Screen lang={lang} state={screenState} />
    </div>
  );
}
