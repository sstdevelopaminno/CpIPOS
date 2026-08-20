"use client";

import { useEffect, useMemo, useState } from "react";
import { buildCustomerDisplayV2Channel } from "@/lib/customer-display-v2";
import type { Language } from "@/lib/i18n";

const SALES_SNAPSHOT_KEY = "pos_sales_snapshot_v001";

type SalesSnapshot = {
  branch_name?: string | null;
  store_profile?: { display_name?: string | null; name?: string | null } | null;
  device_policy?: { id?: string | null; code?: string | null; name?: string | null } | null;
};

function readSnapshot(): SalesSnapshot | null {
  try {
    const raw = window.localStorage.getItem(SALES_SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as SalesSnapshot) : null;
  } catch {
    return null;
  }
}

export function PosCustomerDisplayV2Setup({ lang }: { lang: Language }) {
  const [snapshot, setSnapshot] = useState<SalesSnapshot | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSnapshot(readSnapshot());
    const onStorage = (event: StorageEvent) => {
      if (event.key === SALES_SNAPSHOT_KEY) setSnapshot(readSnapshot());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const channel = useMemo(
    () => buildCustomerDisplayV2Channel({ id: snapshot?.device_policy?.id, code: snapshot?.device_policy?.code }),
    [snapshot?.device_policy?.code, snapshot?.device_policy?.id]
  );
  const storeName = String(snapshot?.store_profile?.display_name ?? snapshot?.store_profile?.name ?? "-").trim() || "-";
  const deviceName = String(snapshot?.device_policy?.name ?? snapshot?.device_policy?.code ?? "-").trim() || "-";

  async function createPairing() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/customer-display/pairings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel })
      });
      const body = (await response.json()) as { data?: { pairing_code?: string; expires_at?: string }; error?: { message?: string } };
      if (!response.ok || !body.data?.pairing_code) throw new Error(body.error?.message ?? "Pairing code creation failed.");
      setPairingCode(body.data.pairing_code);
      setExpiresAt(body.data.expires_at ?? null);
    } catch (cause) {
      setPairingCode(null);
      setExpiresAt(null);
      setError(cause instanceof Error ? cause.message : "Pairing code creation failed.");
    } finally {
      setBusy(false);
    }
  }

  const livePath = pairingCode
    ? `/customer-display/v2?pairing_code=${encodeURIComponent(pairingCode)}&channel=${encodeURIComponent(channel)}`
    : "/customer-display/v2";

  return (
    <main style={{ minHeight: "100vh", background: "#f5f7fb", padding: 24, fontFamily: "Arial, sans-serif", color: "#0f172a" }}>
      <section style={{ width: "min(760px,100%)", margin: "0 auto", background: "#fff", border: "1px solid #dbe3ec", borderRadius: 20, padding: 24, boxShadow: "0 18px 50px rgba(15,23,42,.06)", display: "grid", gap: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>{lang === "th" ? "ตั้งค่าจอลูกค้า V2" : "Customer Display V2 Setup"}</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b" }}>
            {lang === "th" ? "จับคู่จอกับเครื่อง POS เครื่องนี้โดยเฉพาะ เพื่อป้องกันหลายเคาน์เตอร์เขียนทับกัน" : "Pair a display to this POS terminal so multiple counters cannot overwrite each other."}
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
          <div><small style={{ color: "#64748b" }}>{lang === "th" ? "ร้าน" : "Store"}</small><strong style={{ display: "block", marginTop: 4 }}>{storeName}</strong></div>
          <div><small style={{ color: "#64748b" }}>{lang === "th" ? "สาขา" : "Branch"}</small><strong style={{ display: "block", marginTop: 4 }}>{snapshot?.branch_name ?? "-"}</strong></div>
          <div><small style={{ color: "#64748b" }}>{lang === "th" ? "เครื่อง" : "Terminal"}</small><strong style={{ display: "block", marginTop: 4 }}>{deviceName}</strong></div>
        </div>

        <div style={{ borderRadius: 14, background: "#f8fafc", border: "1px solid #e2e8f0", padding: 14 }}>
          <small style={{ color: "#64748b" }}>Device-scoped channel</small>
          <code style={{ display: "block", marginTop: 5, overflowWrap: "anywhere" }}>{channel}</code>
        </div>

        <button type="button" disabled={busy} onClick={() => void createPairing()} style={{ height: 48, border: 0, borderRadius: 12, background: "#1769d2", color: "#fff", fontWeight: 900, cursor: "pointer" }}>
          {busy ? "..." : lang === "th" ? "สร้างรหัสจับคู่จอ" : "Create pairing code"}
        </button>

        {pairingCode ? (
          <section style={{ display: "grid", gap: 12, textAlign: "center", border: "1px solid #bfdbfe", borderRadius: 16, padding: 18, background: "#eff6ff" }}>
            <small style={{ color: "#475569" }}>{lang === "th" ? "รหัสจับคู่ 6 หลัก" : "6-digit pairing code"}</small>
            <strong style={{ fontSize: 40, letterSpacing: 8 }}>{pairingCode}</strong>
            {expiresAt ? <small style={{ color: "#64748b" }}>{lang === "th" ? "หมดอายุ" : "Expires"}: {new Date(expiresAt).toLocaleString(lang === "th" ? "th-TH" : "en-US")}</small> : null}
            <a href={livePath} target="_blank" rel="noreferrer" style={{ display: "grid", placeItems: "center", height: 44, borderRadius: 10, background: "#0f172a", color: "#fff", textDecoration: "none", fontWeight: 900 }}>
              {lang === "th" ? "เปิดจอลูกค้า V2" : "Open Customer Display V2"}
            </a>
          </section>
        ) : null}

        {!snapshot?.device_policy?.id && !snapshot?.device_policy?.code ? (
          <small style={{ color: "#b45309" }}>{lang === "th" ? "ยังไม่พบข้อมูลเครื่อง POS ใน snapshot กรุณาเปิดหน้าขายให้โหลดข้อมูลเครื่องก่อน แล้วกลับมาหน้านี้" : "POS device snapshot is not loaded yet. Open the sales screen once, then return here."}</small>
        ) : null}
        {error ? <small style={{ color: "#dc2626" }}>{error}</small> : null}
      </section>
    </main>
  );
}
