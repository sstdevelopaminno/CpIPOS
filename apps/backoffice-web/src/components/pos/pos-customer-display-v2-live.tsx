"use client";

import { useEffect, useMemo, useState } from "react";
import { PosCustomerDisplayV2Screen, type CustomerDisplayV2ScreenState } from "@/components/pos/pos-customer-display-v2-screen";
import type { CustomerDisplayV2Payload } from "@/lib/customer-display-v2";
import type { Language } from "@/lib/i18n";

const DEVICE_TOKEN_KEY = "pos_customer_display_v2_device_token_v001";
const DEVICE_CHANNEL_KEY = "pos_customer_display_v2_channel_v001";

type DisplayApiResponse = {
  data?: {
    channel?: string;
    data?: {
      payload?: CustomerDisplayV2Payload | Record<string, unknown>;
      updated_at?: string;
    } | null;
  } | null;
  error?: { code?: string; message?: string } | null;
};

function normalizeChannel(value: string | null | undefined) {
  return String(value ?? "main").trim().toLowerCase().slice(0, 64) || "main";
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

export function PosCustomerDisplayV2Live({ lang }: { lang: Language }) {
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [channel, setChannel] = useState("main");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [payload, setPayload] = useState<CustomerDisplayV2Payload | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDeviceToken(window.localStorage.getItem(DEVICE_TOKEN_KEY));
    setChannel(normalizeChannel(window.localStorage.getItem(DEVICE_CHANNEL_KEY) || params.get("channel")));
    const code = String(params.get("pairing_code") ?? "").replace(/\D/g, "").slice(0, 6);
    if (code) setPairingCode(code);
  }, []);

  async function claimPairing(rawCode: string) {
    const code = String(rawCode).replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      setPairingError(lang === "th" ? "กรอกรหัสจับคู่ 6 หลัก" : "Enter the 6-digit pairing code.");
      return false;
    }
    setPairingBusy(true);
    setPairingError(null);
    try {
      const response = await fetch("/api/pos/customer-display/pairings/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairing_code: code, device_name: navigator.userAgent.slice(0, 120) })
      });
      const body = (await response.json()) as { data?: { device_token?: string; channel?: string }; error?: { message?: string } };
      if (!response.ok || !body.data?.device_token) throw new Error(body.error?.message ?? "Pairing failed.");
      const nextChannel = normalizeChannel(body.data.channel);
      window.localStorage.setItem(DEVICE_TOKEN_KEY, body.data.device_token);
      window.localStorage.setItem(DEVICE_CHANNEL_KEY, nextChannel);
      setDeviceToken(body.data.device_token);
      setChannel(nextChannel);
      setPairingCode("");
      return true;
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : "Pairing failed.");
      return false;
    } finally {
      setPairingBusy(false);
    }
  }

  useEffect(() => {
    if (!pairingCode || deviceToken || pairingBusy) return;
    void claimPairing(pairingCode);
    // claimPairing intentionally follows query-code changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairingCode, deviceToken]);

  useEffect(() => {
    if (!deviceToken) return;
    let disposed = false;
    let inFlight = false;

    const sync = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/pos/customer-display?channel=${encodeURIComponent(channel)}`, {
          cache: "no-store",
          headers: { "x-customer-display-token": deviceToken }
        });
        if (response.status === 401 || response.status === 403) {
          window.localStorage.removeItem(DEVICE_TOKEN_KEY);
          window.localStorage.removeItem(DEVICE_CHANNEL_KEY);
          setDeviceToken(null);
          setPayload(null);
          setPairingError(lang === "th" ? "การจับคู่หมดอายุ กรุณาจับคู่จอใหม่" : "Pairing expired. Please pair again.");
          return;
        }
        if (!response.ok) return;
        const body = (await response.json()) as DisplayApiResponse;
        const next = body.data?.data?.payload as CustomerDisplayV2Payload | undefined;
        if (!next || next.version !== 2) return;
        if (!disposed) setPayload(next);
      } catch {
        // Keep the most recent state on transient connectivity issues.
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
  }, [channel, deviceToken, lang]);

  const screenState = useMemo(() => (payload ? toScreenState(payload) : emptyIdleState()), [payload]);
  const hideCashRowsForTransferPaid = payload?.phase === "paid" && payload.payment_method === "bank_transfer";

  if (!deviceToken) {
    return (
      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#eef4fb", fontFamily: "Arial, sans-serif" }}>
        <section style={{ width: "min(440px,94vw)", padding: 24, borderRadius: 20, background: "#fff", border: "1px solid #dbe3ec", boxShadow: "0 18px 50px rgba(15,23,42,.08)", display: "grid", gap: 14 }}>
          <strong style={{ fontSize: 22 }}>{lang === "th" ? "จับคู่จอแสดงผลลูกค้า V2" : "Pair Customer Display V2"}</strong>
          <span style={{ color: "#64748b", fontSize: 14 }}>{lang === "th" ? "กรอกรหัสจับคู่ 6 หลักจากเครื่อง POS ที่ต้องการเชื่อม" : "Enter the 6-digit pairing code from the POS terminal."}</span>
          <input
            inputMode="numeric"
            value={pairingCode}
            onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            style={{ height: 48, borderRadius: 12, border: "1px solid #cbd5e1", padding: "0 14px", fontSize: 22, letterSpacing: 4 }}
          />
          <button
            type="button"
            disabled={pairingBusy}
            onClick={() => void claimPairing(pairingCode)}
            style={{ height: 46, border: 0, borderRadius: 12, background: "#1769d2", color: "#fff", fontWeight: 900, cursor: "pointer" }}
          >
            {pairingBusy ? "..." : lang === "th" ? "เชื่อมต่อจอ" : "Pair display"}
          </button>
          {pairingError ? <small style={{ color: "#dc2626" }}>{pairingError}</small> : null}
        </section>
      </main>
    );
  }

  return (
    <div
      data-cdv2-transfer-paid={hideCashRowsForTransferPaid ? "1" : "0"}
      style={{ width: "100vw", height: "100dvh", minHeight: "100vh", overflow: "hidden" }}
    >
      {hideCashRowsForTransferPaid ? (
        <style>{`[data-cdv2-transfer-paid="1"] .cdv2-cash-detail { display: none; }`}</style>
      ) : null}
      <PosCustomerDisplayV2Screen lang={lang} state={screenState} />
    </div>
  );
}
