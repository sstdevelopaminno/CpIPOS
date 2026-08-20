"use client";

import type { Language } from "@/lib/i18n";

export type CustomerDisplayV2Phase = "idle" | "cart" | "cash" | "qr" | "paid";

export type CustomerDisplayV2Item = {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
};

export type CustomerDisplayV2ScreenState = {
  phase: CustomerDisplayV2Phase;
  store_name: string;
  store_logo_url?: string | null;
  branch_name?: string | null;
  device_name?: string | null;
  order_no?: string | null;
  items: CustomerDisplayV2Item[];
  subtotal_amount?: number | null;
  discount_amount?: number | null;
  total_amount: number;
  cash_received?: number | null;
  change_amount?: number | null;
  payment_qr_url?: string | null;
  media_urls?: string[];
};

const SYSTEM_SYMBOL_URL = "/brand/cpipos-symbol-transparent.png";

function formatMoney(value: number, lang: Language) {
  return new Intl.NumberFormat(lang === "th" ? "th-TH" : "en-US", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

function SystemBrand() {
  return (
    <div className="cdv2-system-brand" aria-label="CpIPOS">
      {/* Existing transparent repository asset. No generated image. */}
      <img src={SYSTEM_SYMBOL_URL} alt="" className="cdv2-system-symbol" />
      <div className="cdv2-system-wordmark" aria-hidden="true">
        <span className="cdv2-system-wordmark-dark">Cp</span>
        <span className="cdv2-system-wordmark-blue">IPOS</span>
      </div>
    </div>
  );
}

function LogoOrSystem({ logoUrl, storeName }: { logoUrl?: string | null; storeName: string }) {
  if (!String(logoUrl ?? "").trim()) return <SystemBrand />;
  return <img src={String(logoUrl)} alt={storeName} className="cdv2-store-logo" />;
}

function MediaSurface({ mediaUrl }: { mediaUrl?: string | null }) {
  if (!String(mediaUrl ?? "").trim()) return <SystemBrand />;
  return <img src={String(mediaUrl)} alt="" className="cdv2-media-image" />;
}

export function PosCustomerDisplayV2Screen({
  lang,
  state
}: {
  lang: Language;
  state: CustomerDisplayV2ScreenState;
}) {
  const t = lang === "th"
    ? {
        bill: "บิล",
        items: "รายการสินค้า",
        qty: "จำนวน",
        unit: "ราคา/หน่วย",
        amount: "รวม",
        discount: "ส่วนลด",
        total: "ยอดชำระ",
        received: "รับเงินมา",
        change: "เงินทอน",
        qr: "QR ชำระเงิน",
        paid: "ชำระเงินสำเร็จ",
        thanks: "ขอบคุณที่ใช้บริการ",
        powered: "Powered by CpIPOS"
      }
    : {
        bill: "Bill",
        items: "Items",
        qty: "Qty",
        unit: "Unit",
        amount: "Amount",
        discount: "Discount",
        total: "Amount Due",
        received: "Cash Received",
        change: "Change",
        qr: "Payment QR",
        paid: "Payment Successful",
        thanks: "Thank you",
        powered: "Powered by CpIPOS"
      };

  const total = Number(state.total_amount ?? 0);
  const discount = Math.max(0, Number(state.discount_amount ?? 0));
  const mediaUrl = state.media_urls?.find((value) => String(value ?? "").trim()) ?? null;
  const showCash = state.phase === "cash" || state.phase === "paid";

  return (
    <main className="cdv2-screen" data-phase={state.phase}>
      <style>{`
        * { box-sizing: border-box; }
        html, body { margin: 0; min-width: 100%; min-height: 100%; }
        .cdv2-screen {
          width: 100vw;
          height: 100dvh;
          min-height: 100vh;
          overflow: hidden;
          background: #fff;
          color: #0f172a;
          font-family: Arial, "Noto Sans Thai", sans-serif;
        }
        .cdv2-idle {
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          padding: clamp(22px, 5vw, 72px);
          background: radial-gradient(circle at 50% 40%, #fff 0%, #f4f9ff 58%, #e8f2ff 100%);
        }
        .cdv2-idle-inner {
          width: min(78vw, 880px);
          max-height: 88vh;
          display: grid;
          justify-items: center;
          align-content: center;
          gap: clamp(14px, 3vh, 30px);
          text-align: center;
        }
        .cdv2-idle-logo { width: min(56vw, 560px); height: min(34vh, 280px); display: grid; place-items: center; }
        .cdv2-idle-name { margin: 0; font-size: clamp(24px, 3vw, 50px); line-height: 1.08; font-weight: 900; }
        .cdv2-layout { width: 100%; height: 100%; display: grid; grid-template-columns: minmax(0,1.38fr) minmax(280px,1fr); }
        .cdv2-transaction { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0,1fr) auto; border-right: 1px solid #dbe3ec; }
        .cdv2-header { padding: clamp(14px,2.2vw,28px) clamp(16px,2.5vw,34px); border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; }
        .cdv2-store-name { margin: 0; font-size: clamp(22px,2.2vw,34px); line-height: 1.1; font-weight: 950; }
        .cdv2-branch-device { margin-top: 7px; color: #64748b; font-size: clamp(13px,1.15vw,18px); font-weight: 750; }
        .cdv2-bill { flex: 0 0 auto; text-align: right; white-space: nowrap; font-size: clamp(13px,1.2vw,18px); font-weight: 900; }
        .cdv2-items { min-height: 0; overflow: auto; padding: clamp(12px,1.8vw,24px) clamp(14px,2.2vw,30px); }
        .cdv2-row { display: grid; grid-template-columns: minmax(0,1fr) minmax(52px,.28fr) minmax(82px,.48fr) minmax(92px,.54fr); gap: clamp(8px,1.1vw,16px); align-items: center; }
        .cdv2-head { padding: 0 10px 9px; color: #64748b; font-size: clamp(11px,.95vw,14px); font-weight: 800; }
        .cdv2-item-list { display: grid; gap: clamp(7px,1.1vh,12px); }
        .cdv2-item { padding: clamp(11px,1.4vw,17px) 10px; border-radius: 14px; border: 1px solid #e2e8f0; background: #f8fafc; }
        .cdv2-item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: clamp(15px,1.45vw,22px); font-weight: 900; }
        .cdv2-center { text-align: center; font-size: clamp(15px,1.35vw,21px); font-weight: 850; }
        .cdv2-money { text-align: right; font-size: clamp(13px,1.25vw,20px); font-weight: 850; }
        .cdv2-summary { padding: clamp(12px,1.8vw,24px) clamp(16px,2.5vw,34px); border-top: 1px solid #e2e8f0; background: #fbfdff; display: grid; gap: clamp(5px,1vh,10px); }
        .cdv2-summary-line { display: flex; justify-content: space-between; align-items: baseline; gap: 18px; font-size: clamp(15px,1.4vw,22px); }
        .cdv2-discount { color: #dc2626; font-weight: 900; }
        .cdv2-total-label { color: #475569; font-weight: 850; }
        .cdv2-total { font-size: clamp(32px,4.2vw,62px); line-height: .95; font-weight: 950; }
        .cdv2-change { color: #047857; font-size: clamp(18px,1.9vw,28px); font-weight: 950; }
        .cdv2-media { min-width: 0; min-height: 0; position: relative; display: grid; place-items: center; overflow: hidden; padding: clamp(18px,2.2vw,34px); background: linear-gradient(155deg,#f8fafc,#eef2ff 54%,#ecfeff); }
        .cdv2-media-inner { width: 100%; height: 100%; min-height: 0; display: grid; place-items: center; text-align: center; }
        .cdv2-media-brand { width: 100%; height: 100%; min-height: 0; display: grid; grid-template-rows: minmax(0,1fr) auto; }
        .cdv2-powered { justify-self: end; color: #64748b; font-size: clamp(10px,.9vw,13px); font-weight: 800; }
        .cdv2-store-logo, .cdv2-media-image { display: block; max-width: 86%; max-height: 78%; object-fit: contain; background: transparent; }
        .cdv2-system-brand { width: 100%; height: 100%; min-height: 0; display: grid; place-items: center; align-content: center; gap: clamp(7px,1.5vh,14px); background: transparent; }
        .cdv2-system-symbol { display: block; width: min(31%,180px); max-height: 46%; object-fit: contain; background: transparent; }
        .cdv2-system-wordmark { line-height: 1; font-size: clamp(32px,4vw,64px); font-weight: 950; letter-spacing: -2px; background: transparent; }
        .cdv2-media .cdv2-system-symbol { width: min(52%,260px); max-height: 58%; }
        .cdv2-media .cdv2-system-wordmark { font-size: clamp(42px,5vw,78px); }
        .cdv2-system-wordmark-dark { color: #354052; }
        .cdv2-system-wordmark-blue { color: #1296ed; }
        .cdv2-qr-block { width: 100%; height: 100%; display: grid; justify-items: center; align-content: center; gap: clamp(12px,2vh,22px); }
        .cdv2-qr-label { color: #2563eb; font-size: clamp(14px,1.45vw,22px); font-weight: 900; }
        .cdv2-qr-img { display: block; width: min(58%,320px); aspect-ratio: 1; object-fit: contain; border-radius: 16px; background: #fff; padding: 8px; box-shadow: 0 18px 48px rgba(15,23,42,.18); }
        .cdv2-qr-placeholder { width: min(54%,290px); aspect-ratio: 1; border-radius: 18px; border: 10px solid #fff; background: repeating-conic-gradient(#111827 0 25%,#fff 0 50%) 50% / 24px 24px; box-shadow: 0 18px 48px rgba(15,23,42,.18); }
        .cdv2-qr-amount { font-size: clamp(30px,4vw,58px); font-weight: 950; }
        .cdv2-paid { display: grid; justify-items: center; align-content: center; gap: clamp(12px,2vh,22px); text-align: center; }
        .cdv2-paid-icon { width: clamp(78px,9vw,112px); aspect-ratio: 1; border-radius: 999px; display: grid; place-items: center; background: #dcfce7; color: #15803d; font-size: clamp(46px,5vw,68px); font-weight: 950; }
        .cdv2-paid-title { margin: 0; color: #166534; font-size: clamp(30px,3.8vw,58px); line-height: 1; }
        .cdv2-thanks { color: #475569; font-size: clamp(16px,1.7vw,24px); }
        @media (max-width: 900px) {
          .cdv2-layout { grid-template-columns: 1fr; grid-template-rows: minmax(0,62%) minmax(0,38%); }
          .cdv2-transaction { border-right: 0; border-bottom: 1px solid #dbe3ec; }
          .cdv2-media { padding: 14px 18px; }
          .cdv2-system-symbol { width: min(22%,130px); }
          .cdv2-system-wordmark { font-size: clamp(25px,5vw,44px); }
          .cdv2-media .cdv2-system-symbol { width: min(36%,180px); max-height: 64%; }
          .cdv2-media .cdv2-system-wordmark { font-size: clamp(30px,6vw,54px); }
          .cdv2-qr-img, .cdv2-qr-placeholder { width: min(32vh,220px); }
          .cdv2-powered { display: none; }
        }
        @media (max-width: 620px) {
          .cdv2-header { padding: 12px 14px; gap: 10px; }
          .cdv2-bill { font-size: 11px; }
          .cdv2-items { padding: 10px 12px; }
          .cdv2-row { grid-template-columns: minmax(0,1fr) 44px 76px; }
          .cdv2-row > :nth-child(3) { display: none; }
          .cdv2-summary { padding: 10px 14px; }
        }
        @media (max-height: 600px) and (min-width: 901px) {
          .cdv2-header { padding-top: 12px; padding-bottom: 10px; }
          .cdv2-items { padding-top: 10px; padding-bottom: 10px; }
          .cdv2-item { padding-top: 9px; padding-bottom: 9px; }
          .cdv2-summary { padding-top: 10px; padding-bottom: 12px; }
        }
      `}</style>

      {state.phase === "idle" ? (
        <section className="cdv2-idle">
          <div className="cdv2-idle-inner">
            <div className="cdv2-idle-logo"><LogoOrSystem logoUrl={state.store_logo_url} storeName={state.store_name} /></div>
            <h1 className="cdv2-idle-name">{state.store_name}</h1>
          </div>
        </section>
      ) : (
        <section className="cdv2-layout">
          <section className="cdv2-transaction">
            <header className="cdv2-header">
              <div>
                <h1 className="cdv2-store-name">{state.store_name}</h1>
                <div className="cdv2-branch-device">{[state.branch_name, state.device_name].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="cdv2-bill">{t.bill} {state.order_no ?? "-"}</div>
            </header>

            <div className="cdv2-items">
              <div className="cdv2-row cdv2-head">
                <span>{t.items}</span>
                <span style={{ textAlign: "center" }}>{t.qty}</span>
                <span style={{ textAlign: "right" }}>{t.unit}</span>
                <span style={{ textAlign: "right" }}>{t.amount}</span>
              </div>
              <div className="cdv2-item-list">
                {state.items.map((item, index) => (
                  <article key={`${item.product_id}-${index}`} className="cdv2-row cdv2-item">
                    <strong className="cdv2-item-name">{item.name}</strong>
                    <strong className="cdv2-center">{item.quantity}</strong>
                    <span className="cdv2-money">{formatMoney(item.price, lang)}</span>
                    <strong className="cdv2-money">{formatMoney(item.price * item.quantity, lang)}</strong>
                  </article>
                ))}
              </div>
            </div>

            <footer className="cdv2-summary">
              {discount > 0.004 ? (
                <div className="cdv2-summary-line cdv2-discount">
                  <span>{t.discount}</span>
                  <strong>-{formatMoney(discount, lang)}</strong>
                </div>
              ) : null}
              <div className="cdv2-summary-line">
                <span className="cdv2-total-label">{t.total}</span>
                <strong className="cdv2-total">{formatMoney(total, lang)}</strong>
              </div>
              {showCash ? (
                <>
                  <div className="cdv2-summary-line cdv2-cash-detail"><span>{t.received}</span><strong>{formatMoney(Number(state.cash_received ?? 0), lang)}</strong></div>
                  <div className="cdv2-summary-line cdv2-change cdv2-cash-detail"><span>{t.change}</span><strong>{formatMoney(Number(state.change_amount ?? 0), lang)}</strong></div>
                </>
              ) : null}
            </footer>
          </section>

          <aside className="cdv2-media">
            {state.phase === "qr" ? (
              <div className="cdv2-media-inner">
                <div className="cdv2-qr-block">
                  <div className="cdv2-qr-label">{t.qr}</div>
                  {state.payment_qr_url ? <img src={state.payment_qr_url} alt={t.qr} className="cdv2-qr-img" /> : <div className="cdv2-qr-placeholder" />}
                  <div className="cdv2-qr-amount">{formatMoney(total, lang)}</div>
                </div>
              </div>
            ) : state.phase === "paid" ? (
              <div className="cdv2-media-inner">
                <div className="cdv2-paid">
                  <div className="cdv2-paid-icon">✓</div>
                  <h2 className="cdv2-paid-title">{t.paid}</h2>
                  <div className="cdv2-thanks">{t.thanks}</div>
                </div>
              </div>
            ) : (
              <div className="cdv2-media-brand">
                <MediaSurface mediaUrl={mediaUrl} />
                <div className="cdv2-powered">{t.powered}</div>
              </div>
            )}
          </aside>
        </section>
      )}
    </main>
  );
}
