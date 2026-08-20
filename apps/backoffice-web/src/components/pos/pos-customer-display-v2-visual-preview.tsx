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

type DemoStep = {
  phase: PreviewPhase;
  durationMs: number;
};

const SYSTEM_LOGO_URL = "/brand/cpipos-logo.png";
const LIVE_IDLE_TIMEOUT_MS = 5 * 60_000;
const AUTO_DEMO_SEQUENCE: DemoStep[] = [
  { phase: "idle", durationMs: 7_000 },
  { phase: "cart", durationMs: 8_000 },
  { phase: "cash", durationMs: 7_000 },
  { phase: "qr", durationMs: 8_000 },
  { phase: "paid", durationMs: 7_000 }
];

const MOCK_STORE = {
  displayNameTh: "ร้านทดสอบ 900001",
  displayNameEn: "Test Store 900001",
  branchTh: "สาขาทดสอบ Preview",
  branchEn: "Preview Test Branch",
  deviceName: "POS-01",
  billNo: "#PV-20260820-001",
  logoUrl: null as string | null
};

const MOCK_AD_IMAGE_URLS: string[] = [];

const MOCK_ITEMS: PreviewItem[] = [
  { id: "coffee", nameTh: "ลาเต้เย็น", nameEn: "Iced Latte", quantity: 2, unitPrice: 75 },
  { id: "toast", nameTh: "ขนมปังปิ้งเนยนม", nameEn: "Butter Milk Toast", quantity: 1, unitPrice: 65 },
  { id: "water", nameTh: "น้ำดื่ม", nameEn: "Drinking Water", quantity: 2, unitPrice: 20 }
];

function formatMoney(value: number, lang: Language) {
  return new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function LogoSurface({ imageUrl, label }: { imageUrl: string; label: string }) {
  return (
    <div className="cdv2-logo-surface" aria-label={label}>
      <div className="cdv2-logo-image" style={{ backgroundImage: `url(${imageUrl})` }} />
    </div>
  );
}

function MockQr() {
  return <div className="cdv2-qr-placeholder" aria-label="Payment QR visual placeholder" />;
}

export function PosCustomerDisplayV2VisualPreview({ lang }: { lang: Language }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [adIndex, setAdIndex] = useState(0);
  const phase = AUTO_DEMO_SEQUENCE[stepIndex]?.phase ?? "idle";

  useEffect(() => {
    const current = AUTO_DEMO_SEQUENCE[stepIndex] ?? AUTO_DEMO_SEQUENCE[0];
    const timer = window.setTimeout(() => {
      setStepIndex((index) => (index + 1) % AUTO_DEMO_SEQUENCE.length);
    }, current.durationMs);
    return () => window.clearTimeout(timer);
  }, [stepIndex]);

  useEffect(() => {
    if (MOCK_AD_IMAGE_URLS.length <= 1) return;
    const timer = window.setInterval(() => {
      setAdIndex((current) => (current + 1) % MOCK_AD_IMAGE_URLS.length);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, []);

  const total = useMemo(
    () => MOCK_ITEMS.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    []
  );
  const cashReceived = 500;
  const change = cashReceived - total;
  const storeName = lang === "th" ? MOCK_STORE.displayNameTh : MOCK_STORE.displayNameEn;
  const branchName = lang === "th" ? MOCK_STORE.branchTh : MOCK_STORE.branchEn;
  const storeLogoUrl = MOCK_STORE.logoUrl || SYSTEM_LOGO_URL;
  const mediaUrl = MOCK_AD_IMAGE_URLS[adIndex] || SYSTEM_LOGO_URL;

  const t = lang === "th"
    ? {
        bill: "บิล",
        items: "รายการสินค้า",
        qty: "จำนวน",
        unit: "ราคา/หน่วย",
        amount: "รวม",
        total: "ยอดชำระ",
        received: "รับเงินมา",
        change: "เงินทอน",
        paymentQr: "QR ชำระเงิน",
        paid: "ชำระเงินสำเร็จ",
        thankYou: "ขอบคุณที่ใช้บริการ",
        poweredBy: "Powered by CpIPOS"
      }
    : {
        bill: "Bill",
        items: "Items",
        qty: "Qty",
        unit: "Unit",
        amount: "Amount",
        total: "Amount Due",
        received: "Cash Received",
        change: "Change",
        paymentQr: "Payment QR",
        paid: "Payment Successful",
        thankYou: "Thank you",
        poweredBy: "Powered by CpIPOS"
      };

  const isIdle = phase === "idle";
  const showCash = phase === "cash" || phase === "paid";
  const showQr = phase === "qr";
  const showPaid = phase === "paid";

  return (
    <main className="cdv2-shell" data-phase={phase} data-idle-timeout-ms={LIVE_IDLE_TIMEOUT_MS}>
      <style>{`
        * { box-sizing: border-box; }
        html, body { margin: 0; min-width: 100%; min-height: 100%; }
        .cdv2-shell {
          width: 100vw;
          height: 100dvh;
          min-height: 100vh;
          overflow: hidden;
          background: #ffffff;
          color: #0f172a;
          font-family: Arial, "Noto Sans Thai", sans-serif;
        }
        .cdv2-idle {
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          padding: clamp(24px, 5vw, 72px);
          background: radial-gradient(circle at 50% 42%, #ffffff 0%, #eef6ff 54%, #dcecff 100%);
          text-align: center;
        }
        .cdv2-idle-inner {
          width: min(76vw, 820px);
          display: grid;
          justify-items: center;
          gap: clamp(16px, 3vh, 30px);
        }
        .cdv2-idle-logo { width: min(52vw, 520px); height: min(30vh, 250px); }
        .cdv2-idle-store {
          margin: 0;
          font-size: clamp(24px, 3.1vw, 50px);
          line-height: 1.12;
          font-weight: 900;
          color: #0f172a;
        }
        .cdv2-layout {
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-columns: minmax(0, 1.38fr) minmax(280px, 1fr);
          background: #ffffff;
        }
        .cdv2-transaction {
          min-width: 0;
          min-height: 0;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          border-right: 1px solid #dbe3ec;
        }
        .cdv2-header {
          padding: clamp(14px, 2.2vw, 28px) clamp(16px, 2.5vw, 34px);
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
        }
        .cdv2-store-name { margin: 0; font-size: clamp(22px, 2.2vw, 34px); line-height: 1.1; font-weight: 950; }
        .cdv2-branch-device { margin-top: 7px; color: #64748b; font-size: clamp(13px, 1.15vw, 18px); font-weight: 750; }
        .cdv2-bill { flex: 0 0 auto; text-align: right; font-size: clamp(13px, 1.2vw, 18px); font-weight: 900; white-space: nowrap; }
        .cdv2-items { min-height: 0; overflow: auto; padding: clamp(12px, 1.8vw, 24px) clamp(14px, 2.2vw, 30px); }
        .cdv2-grid-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(52px, .28fr) minmax(82px, .48fr) minmax(92px, .54fr);
          gap: clamp(8px, 1.1vw, 16px);
          align-items: center;
        }
        .cdv2-table-head { padding: 0 10px 9px; color: #64748b; font-size: clamp(11px, .95vw, 14px); font-weight: 800; }
        .cdv2-item-list { display: grid; gap: clamp(7px, 1.1vh, 12px); }
        .cdv2-item { padding: clamp(11px, 1.4vw, 17px) 10px; border-radius: 14px; border: 1px solid #e2e8f0; background: #f8fafc; }
        .cdv2-item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: clamp(15px, 1.45vw, 22px); font-weight: 900; }
        .cdv2-number { text-align: center; font-size: clamp(15px, 1.35vw, 21px); font-weight: 850; }
        .cdv2-money { text-align: right; font-size: clamp(13px, 1.25vw, 20px); font-weight: 850; }
        .cdv2-summary {
          padding: clamp(12px, 1.8vw, 24px) clamp(16px, 2.5vw, 34px);
          border-top: 1px solid #e2e8f0;
          background: #fbfdff;
          display: grid;
          gap: clamp(5px, 1vh, 10px);
        }
        .cdv2-summary-line { display: flex; align-items: baseline; justify-content: space-between; gap: 18px; font-size: clamp(15px, 1.4vw, 22px); }
        .cdv2-total-label { color: #475569; font-weight: 850; }
        .cdv2-total-value { font-size: clamp(32px, 4.2vw, 62px); line-height: .95; font-weight: 950; }
        .cdv2-change { color: #047857; font-weight: 950; font-size: clamp(18px, 1.9vw, 28px); }
        .cdv2-media {
          min-width: 0;
          min-height: 0;
          position: relative;
          display: grid;
          place-items: center;
          overflow: hidden;
          padding: clamp(18px, 2.2vw, 34px);
          background: linear-gradient(155deg, #f8fafc, #eef2ff 54%, #ecfeff);
        }
        .cdv2-media-inner { width: 100%; height: 100%; min-height: 0; display: grid; place-items: center; text-align: center; }
        .cdv2-logo-surface { width: 100%; height: 100%; min-height: 0; display: grid; place-items: center; }
        .cdv2-logo-image { width: min(78%, 520px); height: min(60%, 360px); background-repeat: no-repeat; background-position: center; background-size: contain; }
        .cdv2-media-brand { width: 100%; height: 100%; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; }
        .cdv2-powered { justify-self: end; color: #64748b; font-size: clamp(10px, .9vw, 13px); font-weight: 800; }
        .cdv2-qr-block { width: 100%; display: grid; justify-items: center; align-content: center; gap: clamp(12px, 2vh, 22px); }
        .cdv2-qr-label { color: #2563eb; font-size: clamp(14px, 1.45vw, 22px); font-weight: 900; }
        .cdv2-qr-placeholder {
          width: min(54%, 300px);
          aspect-ratio: 1;
          border-radius: 18px;
          border: clamp(8px, 1vw, 12px) solid #ffffff;
          background: repeating-conic-gradient(#111827 0 25%, #ffffff 0 50%) 50% / clamp(18px, 2.2vw, 28px) clamp(18px, 2.2vw, 28px);
          box-shadow: 0 18px 48px rgba(15, 23, 42, .22);
        }
        .cdv2-qr-amount { font-size: clamp(30px, 4vw, 58px); font-weight: 950; }
        .cdv2-paid { display: grid; justify-items: center; align-content: center; gap: clamp(12px, 2vh, 22px); text-align: center; }
        .cdv2-paid-icon { width: clamp(78px, 9vw, 112px); aspect-ratio: 1; border-radius: 999px; display: grid; place-items: center; background: #dcfce7; color: #15803d; font-size: clamp(46px, 5vw, 68px); font-weight: 950; }
        .cdv2-paid-title { margin: 0; color: #166534; font-size: clamp(30px, 3.8vw, 58px); line-height: 1; }
        .cdv2-thanks { color: #475569; font-size: clamp(16px, 1.7vw, 24px); }
        @media (max-width: 900px) {
          .cdv2-layout { grid-template-columns: 1fr; grid-template-rows: minmax(0, 62%) minmax(0, 38%); }
          .cdv2-transaction { border-right: 0; border-bottom: 1px solid #dbe3ec; }
          .cdv2-media { padding: 14px 18px; }
          .cdv2-logo-image { width: min(54%, 400px); height: min(72%, 240px); }
          .cdv2-qr-placeholder { width: min(32vh, 220px); }
          .cdv2-powered { display: none; }
        }
        @media (max-width: 620px) {
          .cdv2-header { padding: 12px 14px; gap: 10px; }
          .cdv2-bill { font-size: 11px; }
          .cdv2-items { padding: 10px 12px; }
          .cdv2-grid-row { grid-template-columns: minmax(0, 1fr) 44px 76px; }
          .cdv2-grid-row > :nth-child(3) { display: none; }
          .cdv2-item-name { font-size: 14px; }
          .cdv2-summary { padding: 10px 14px; }
        }
        @media (max-height: 600px) and (min-width: 901px) {
          .cdv2-header { padding-top: 12px; padding-bottom: 10px; }
          .cdv2-items { padding-top: 10px; padding-bottom: 10px; }
          .cdv2-item { padding-top: 9px; padding-bottom: 9px; }
          .cdv2-summary { padding-top: 10px; padding-bottom: 12px; }
          .cdv2-logo-image { height: min(58%, 250px); }
        }
      `}</style>

      {isIdle ? (
        <section className="cdv2-idle">
          <div className="cdv2-idle-inner">
            <div className="cdv2-idle-logo"><LogoSurface imageUrl={storeLogoUrl} label={`${storeName} logo`} /></div>
            <h1 className="cdv2-idle-store">{storeName}</h1>
          </div>
        </section>
      ) : (
        <section className="cdv2-layout">
          <section className="cdv2-transaction">
            <header className="cdv2-header">
              <div>
                <h1 className="cdv2-store-name">{storeName}</h1>
                <div className="cdv2-branch-device">{branchName} · {MOCK_STORE.deviceName}</div>
              </div>
              <div className="cdv2-bill">{t.bill} {MOCK_STORE.billNo}</div>
            </header>

            <div className="cdv2-items">
              <div className="cdv2-grid-row cdv2-table-head">
                <span>{t.items}</span>
                <span style={{ textAlign: "center" }}>{t.qty}</span>
                <span style={{ textAlign: "right" }}>{t.unit}</span>
                <span style={{ textAlign: "right" }}>{t.amount}</span>
              </div>
              <div className="cdv2-item-list">
                {MOCK_ITEMS.map((item) => (
                  <article key={item.id} className="cdv2-grid-row cdv2-item">
                    <strong className="cdv2-item-name">{lang === "th" ? item.nameTh : item.nameEn}</strong>
                    <strong className="cdv2-number">{item.quantity}</strong>
                    <span className="cdv2-money">{formatMoney(item.unitPrice, lang)}</span>
                    <strong className="cdv2-money">{formatMoney(item.quantity * item.unitPrice, lang)}</strong>
                  </article>
                ))}
              </div>
            </div>

            <footer className="cdv2-summary">
              <div className="cdv2-summary-line">
                <span className="cdv2-total-label">{t.total}</span>
                <strong className="cdv2-total-value">{formatMoney(total, lang)}</strong>
              </div>
              {showCash ? (
                <>
                  <div className="cdv2-summary-line"><span>{t.received}</span><strong>{formatMoney(cashReceived, lang)}</strong></div>
                  <div className="cdv2-summary-line cdv2-change"><span>{t.change}</span><strong>{formatMoney(change, lang)}</strong></div>
                </>
              ) : null}
            </footer>
          </section>

          <aside className="cdv2-media">
            {showQr ? (
              <div className="cdv2-media-inner">
                <div className="cdv2-qr-block">
                  <div className="cdv2-qr-label">{t.paymentQr}</div>
                  <MockQr />
                  <div className="cdv2-qr-amount">{formatMoney(total, lang)}</div>
                </div>
              </div>
            ) : showPaid ? (
              <div className="cdv2-media-inner">
                <div className="cdv2-paid">
                  <div className="cdv2-paid-icon">✓</div>
                  <h2 className="cdv2-paid-title">{t.paid}</h2>
                  <div className="cdv2-thanks">{t.thankYou}</div>
                </div>
              </div>
            ) : (
              <div className="cdv2-media-brand">
                <LogoSurface imageUrl={mediaUrl} label="Store advertising or CpIPOS fallback" />
                <div className="cdv2-powered">{t.poweredBy}</div>
              </div>
            )}
          </aside>
        </section>
      )}
    </main>
  );
}
