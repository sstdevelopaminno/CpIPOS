"use client";

import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";

type PreviewPhase = "idle" | "cart" | "cash" | "qr" | "paid";

type PreviewItem = {
  id: string;
  nameTh: string;
  nameEn: string;
  quantity: number;
  unitPrice: number;
};

const MOCK_ITEMS: PreviewItem[] = [
  { id: "coffee", nameTh: "ลาเต้เย็น", nameEn: "Iced Latte", quantity: 2, unitPrice: 75 },
  { id: "toast", nameTh: "ขนมปังปิ้งเนยนม", nameEn: "Butter Milk Toast", quantity: 1, unitPrice: 65 },
  { id: "water", nameTh: "น้ำดื่ม", nameEn: "Drinking Water", quantity: 2, unitPrice: 20 }
];

const PREVIEW_PHASES: Array<{ id: PreviewPhase; th: string; en: string }> = [
  { id: "idle", th: "พักหน้าจอ", en: "Idle" },
  { id: "cart", th: "รายการสินค้า", en: "Cart" },
  { id: "cash", th: "รับเงินสด", en: "Cash" },
  { id: "qr", th: "QR ชำระเงิน", en: "QR Payment" },
  { id: "paid", th: "ชำระสำเร็จ", en: "Paid" }
];

const ADS = [
  { th: "โปรโมชั่นพิเศษประจำเดือน", en: "Monthly Special", noteTh: "อัปโหลดภาพโฆษณาของร้านและกำหนดลำดับการแสดงได้", noteEn: "Store ads can be uploaded and ordered per display profile." },
  { th: "เมนูแนะนำวันนี้", en: "Today's Recommended Menu", noteTh: "ใช้พื้นที่นี้แสดงสินค้าเด่น โปรโมชั่น หรือข้อมูลร้าน", noteEn: "Use this area for featured items, promotions, or store information." },
  { th: "ขอบคุณที่ใช้บริการ", en: "Thank You", noteTh: "โลโก้ร้านและโลโก้ CpIPOS แสดงร่วมกันได้ตามการตั้งค่า", noteEn: "Store and CpIPOS branding can be configured independently." }
];

function formatMoney(value: number, lang: Language) {
  return new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function MockQr() {
  return (
    <div
      aria-label="Non-functional QR visual placeholder"
      style={{
        width: "min(27vw, 250px)",
        aspectRatio: "1",
        borderRadius: 22,
        border: "12px solid white",
        background:
          "repeating-conic-gradient(#111827 0 25%,#ffffff 0 50%) 50% / 26px 26px",
        boxShadow: "0 24px 60px rgba(15,23,42,.28)",
        position: "relative"
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "38%",
          borderRadius: 12,
          display: "grid",
          placeItems: "center",
          background: "white",
          color: "#111827",
          fontSize: 11,
          fontWeight: 900,
          textAlign: "center",
          lineHeight: 1.05,
          padding: 4
        }}
      >
        VISUAL<br />PREVIEW
      </div>
    </div>
  );
}

export function PosCustomerDisplayV2VisualPreview({ lang }: { lang: Language }) {
  const [phase, setPhase] = useState<PreviewPhase>("cart");
  const [adIndex, setAdIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setAdIndex((current) => (current + 1) % ADS.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  const total = useMemo(
    () => MOCK_ITEMS.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    []
  );
  const cashReceived = 500;
  const change = cashReceived - total;
  const ad = ADS[adIndex];
  const t = lang === "th"
    ? {
        preview: "Customer Display V2 · Visual Preview",
        safe: "Mock data only · ไม่เชื่อม API / Database",
        store: "ร้านตัวอย่าง CpIPOS",
        branch: "สาขาทดสอบ Preview",
        counter: "เคาน์เตอร์ POS-01",
        bill: "บิล #PV-20260820-001",
        items: "รายการสินค้า",
        qty: "จำนวน",
        unit: "ราคา/หน่วย",
        amount: "รวม",
        total: "ยอดชำระ",
        received: "รับเงินมา",
        change: "เงินทอน",
        scan: "สแกนเพื่อชำระเงิน",
        promptpay: "PromptPay / Payment QR",
        qrHint: "QR ในหน้านี้เป็นภาพจำลองและชำระเงินจริงไม่ได้",
        paid: "ชำระเงินสำเร็จ",
        thankYou: "ขอบคุณที่ใช้บริการ",
        idle: "ยินดีต้อนรับ",
        idleHint: "เมื่อไม่มีรายการขาย จอสามารถใช้พื้นที่เต็มเพื่อแสดงโฆษณาและโลโก้ร้าน",
        adLabel: "พื้นที่โฆษณา",
        system: "Powered by CpIPOS",
        ratio: "Layout 58% รายการ / 42% สื่อ",
        deviceScope: "Target scope: tenant → branch → POS device → display"
      }
    : {
        preview: "Customer Display V2 · Visual Preview",
        safe: "Mock data only · No API / database connection",
        store: "CpIPOS Demo Store",
        branch: "Preview Branch",
        counter: "Counter POS-01",
        bill: "Bill #PV-20260820-001",
        items: "Items",
        qty: "Qty",
        unit: "Unit",
        amount: "Amount",
        total: "Amount Due",
        received: "Cash Received",
        change: "Change",
        scan: "Scan to Pay",
        promptpay: "PromptPay / Payment QR",
        qrHint: "This QR is a non-functional visual placeholder.",
        paid: "Payment Successful",
        thankYou: "Thank you",
        idle: "Welcome",
        idleHint: "When the cart is empty, the full display can rotate ads and store branding.",
        adLabel: "Advertising area",
        system: "Powered by CpIPOS",
        ratio: "Layout 58% transaction / 42% media",
        deviceScope: "Target scope: tenant → branch → POS device → display"
      };

  const isIdle = phase === "idle";
  const showCash = phase === "cash" || phase === "paid";
  const showQr = phase === "qr";
  const showPaid = phase === "paid";

  return (
    <main style={{ minHeight: "100vh", background: "#eef2f7", color: "#0f172a", fontFamily: "Arial, sans-serif" }}>
      <section
        style={{
          minHeight: "100vh",
          display: "grid",
          gridTemplateRows: "auto minmax(0,1fr)",
          gap: 12,
          padding: 12
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            padding: "10px 14px",
            borderRadius: 16,
            background: "#ffffff",
            border: "1px solid #dbe3ec",
            boxShadow: "0 10px 28px rgba(15,23,42,.06)"
          }}
        >
          <div>
            <div style={{ fontSize: 17, fontWeight: 900 }}>{t.preview}</div>
            <div style={{ marginTop: 3, fontSize: 12, color: "#64748b" }}>{t.safe}</div>
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {PREVIEW_PHASES.map((item) => {
              const selected = item.id === phase;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPhase(item.id)}
                  style={{
                    minHeight: 36,
                    padding: "0 12px",
                    borderRadius: 10,
                    border: selected ? "1px solid #0f172a" : "1px solid #cbd5e1",
                    background: selected ? "#0f172a" : "#ffffff",
                    color: selected ? "#ffffff" : "#334155",
                    fontWeight: 800,
                    cursor: "pointer"
                  }}
                >
                  {lang === "th" ? item.th : item.en}
                </button>
              );
            })}
          </div>
        </header>

        <section
          style={{
            minHeight: 0,
            overflow: "hidden",
            borderRadius: 24,
            background: "#ffffff",
            border: "1px solid #dbe3ec",
            boxShadow: "0 22px 70px rgba(15,23,42,.10)"
          }}
        >
          {isIdle ? (
            <div
              style={{
                minHeight: "calc(100vh - 96px)",
                display: "grid",
                placeItems: "center",
                textAlign: "center",
                padding: 40,
                background: "linear-gradient(135deg,#0f172a,#1d4ed8 54%,#0f766e)",
                color: "#ffffff"
              }}
            >
              <div style={{ maxWidth: 900 }}>
                <div style={{ fontSize: 18, opacity: .8, fontWeight: 800 }}>{t.store}</div>
                <div style={{ marginTop: 16, fontSize: "clamp(52px,8vw,110px)", lineHeight: .95, fontWeight: 950 }}>{t.idle}</div>
                <div style={{ marginTop: 24, fontSize: "clamp(18px,2.2vw,30px)", opacity: .88 }}>{t.idleHint}</div>
                <div style={{ marginTop: 42, display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ border: "1px solid rgba(255,255,255,.28)", borderRadius: 999, padding: "10px 16px" }}>LOGO STORE</span>
                  <span style={{ border: "1px solid rgba(255,255,255,.28)", borderRadius: 999, padding: "10px 16px" }}>CpIPOS</span>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ minHeight: "calc(100vh - 96px)", display: "grid", gridTemplateColumns: "minmax(0,58fr) minmax(320px,42fr)" }}>
              <section style={{ minWidth: 0, display: "grid", gridTemplateRows: "auto minmax(0,1fr) auto", borderRight: "2px solid #e2e8f0" }}>
                <header style={{ padding: "22px 26px 16px", borderBottom: "1px solid #e2e8f0" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18 }}>
                    <div>
                      <div style={{ fontSize: 28, fontWeight: 950 }}>{t.store}</div>
                      <div style={{ marginTop: 7, color: "#64748b", fontWeight: 700 }}>{t.branch} · {t.counter}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 900 }}>{t.bill}</div>
                      <div style={{ marginTop: 6, color: "#64748b", fontSize: 13 }}>{t.deviceScope}</div>
                    </div>
                  </div>
                </header>

                <div style={{ minHeight: 0, overflow: "auto", padding: "18px 26px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 80px 120px 120px", gap: 12, padding: "0 12px 10px", color: "#64748b", fontWeight: 800, fontSize: 13 }}>
                    <span>{t.items}</span><span style={{ textAlign: "center" }}>{t.qty}</span><span style={{ textAlign: "right" }}>{t.unit}</span><span style={{ textAlign: "right" }}>{t.amount}</span>
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {MOCK_ITEMS.map((item) => (
                      <article key={item.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 80px 120px 120px", gap: 12, alignItems: "center", padding: "16px 12px", borderRadius: 14, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                        <strong style={{ fontSize: 20 }}>{lang === "th" ? item.nameTh : item.nameEn}</strong>
                        <strong style={{ textAlign: "center", fontSize: 20 }}>{item.quantity}</strong>
                        <span style={{ textAlign: "right", fontWeight: 800 }}>{formatMoney(item.unitPrice, lang)}</span>
                        <strong style={{ textAlign: "right", fontSize: 19 }}>{formatMoney(item.quantity * item.unitPrice, lang)}</strong>
                      </article>
                    ))}
                  </div>
                </div>

                <footer style={{ padding: "18px 26px 24px", borderTop: "1px solid #e2e8f0", background: "#fbfdff" }}>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "baseline" }}>
                      <span style={{ color: "#475569", fontSize: 18, fontWeight: 800 }}>{t.total}</span>
                      <strong style={{ fontSize: "clamp(34px,4vw,58px)", color: "#0f172a" }}>{formatMoney(total, lang)}</strong>
                    </div>
                    {showCash ? (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, fontSize: 21 }}><span>{t.received}</span><strong>{formatMoney(cashReceived, lang)}</strong></div>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, fontSize: 25, color: "#047857" }}><span style={{ fontWeight: 900 }}>{t.change}</span><strong>{formatMoney(change, lang)}</strong></div>
                      </>
                    ) : null}
                  </div>
                </footer>
              </section>

              <aside style={{ minWidth: 0, padding: 24, display: "grid", gridTemplateRows: "minmax(0,1fr) auto", gap: 18, background: "linear-gradient(155deg,#f8fafc,#eef2ff 52%,#ecfeff)" }}>
                {showQr ? (
                  <div style={{ display: "grid", placeItems: "center", textAlign: "center" }}>
                    <div>
                      <div style={{ color: "#2563eb", fontWeight: 950, letterSpacing: .4 }}>{t.promptpay}</div>
                      <h2 style={{ margin: "8px 0 18px", fontSize: "clamp(30px,4vw,54px)" }}>{t.scan}</h2>
                      <MockQr />
                      <div style={{ marginTop: 18, fontSize: "clamp(28px,3.4vw,48px)", fontWeight: 950 }}>{formatMoney(total, lang)}</div>
                      <p style={{ margin: "12px auto 0", maxWidth: 390, color: "#64748b", fontSize: 13 }}>{t.qrHint}</p>
                    </div>
                  </div>
                ) : showPaid ? (
                  <div style={{ display: "grid", placeItems: "center", textAlign: "center" }}>
                    <div>
                      <div style={{ width: 104, height: 104, borderRadius: 999, margin: "0 auto 22px", display: "grid", placeItems: "center", background: "#dcfce7", color: "#15803d", fontSize: 58, fontWeight: 950 }}>✓</div>
                      <h2 style={{ margin: 0, fontSize: "clamp(34px,4vw,58px)", color: "#166534" }}>{t.paid}</h2>
                      <div style={{ marginTop: 20, color: "#475569", fontSize: 20 }}>{t.thankYou}</div>
                      <div style={{ marginTop: 24, padding: "18px 22px", borderRadius: 16, background: "#ffffff", border: "1px solid #bbf7d0" }}>
                        <div style={{ color: "#64748b", fontWeight: 800 }}>{t.change}</div>
                        <strong style={{ display: "block", marginTop: 4, fontSize: 38, color: "#047857" }}>{formatMoney(change, lang)}</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", placeItems: "stretch" }}>
                    <div style={{ minHeight: 0, borderRadius: 22, padding: 28, color: "#ffffff", display: "grid", alignContent: "end", background: adIndex === 0 ? "linear-gradient(145deg,#7c3aed,#2563eb)" : adIndex === 1 ? "linear-gradient(145deg,#ea580c,#db2777)" : "linear-gradient(145deg,#0f766e,#0891b2)" }}>
                      <div style={{ fontSize: 13, fontWeight: 900, opacity: .78, textTransform: "uppercase", letterSpacing: 1 }}>{t.adLabel} · {adIndex + 1}/{ADS.length}</div>
                      <div style={{ marginTop: 12, fontSize: "clamp(34px,4vw,62px)", fontWeight: 950, lineHeight: .98 }}>{lang === "th" ? ad.th : ad.en}</div>
                      <div style={{ marginTop: 18, fontSize: "clamp(16px,1.7vw,23px)", opacity: .88, lineHeight: 1.35 }}>{lang === "th" ? ad.noteTh : ad.noteEn}</div>
                    </div>
                  </div>
                )}

                <footer style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", color: "#475569", fontSize: 13, fontWeight: 800 }}>
                  <span>{t.ratio}</span>
                  <span>{t.system}</span>
                </footer>
              </aside>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
