export type ReceiptHtmlItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  note?: string | null;
};

export type ReceiptHtmlInput = {
  paperWidthMm: 58 | 80;
  currencyCode?: "THB" | "LAK";
  languageCode?: "th" | "en" | "lo";
  storeName: string;
  branchName: string;
  storeAddress?: string | null;
  storePhone?: string | null;
  logoUrl?: string | null;
  sellerName: string;
  orderNo: string;
  modeLabel?: string | null;
  paidAtIso: string;
  items: ReceiptHtmlItem[];
  discountAmount: number;
  taxAmount?: number;
  totalAmount: number;
  paymentMethod: "cash" | "bank_transfer" | "card" | string;
  cashReceived?: number | null;
  changeAmount?: number | null;
  note?: string | null;
  reprint?: boolean;
};

const DEFAULT_RECEIPT_LOGO_URL = "/brand/cpipos-logo.png";
const RECEIPT_MODE_LABEL_ALIASES: Record<string, string> = {
  "เธซเธเนเธฒเธเธฒเธข": "หน้าขาย",
  "เนเธเน€เธชเธฃเนเธเธขเนเธญเธเธซเธฅเธฑเธ": "ใบเสร็จย้อนหลัง"
};

function clean(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

export function normalizeReceiptModeLabel(value: unknown) {
  const label = clean(value);
  if (!label) return "หน้าขาย";
  return RECEIPT_MODE_LABEL_ALIASES[label] ?? label;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value: unknown, currency: "THB" | "LAK" = "THB") {
  const number = Number(value ?? 0);
  const digits = currency === "LAK" ? 0 : 2;
  return Number.isFinite(number) ? number.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) : currency === "LAK" ? "0" : "0.00";
}

function qty(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0";
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}

function paymentLabel(method: string) {
  if (method === "cash") return "เงินสด";
  if (method === "bank_transfer") return "โอนเงิน";
  if (method === "card") return "บัตร";
  return method || "ชำระเงิน";
}

function dateTime(value: string, language: "th" | "en" | "lo" = "th") {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(language === "lo" ? "lo-LA" : language === "en" ? "en-US" : "th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: language === "lo" ? "Asia/Vientiane" : "Asia/Bangkok" }).format(parsed);
}

export function renderReceiptHtml(input: ReceiptHtmlInput) {
  const currencyCode = input.currencyCode === "LAK" ? "LAK" : "THB";
  const currencySymbol = currencyCode === "LAK" ? "₭" : "฿";
  const languageCode = input.languageCode ?? "th";
  const L = (thai: string, lao: string) => languageCode === "lo" ? lao : thai;
  const paper = input.paperWidthMm;
  const layout = paper === 58
    ? { printableMm: 49, basePx: 12.75, titlePx: 16.5, mutedPx: 11.75, metaPx: 12.5, unitPx: 10.75, summaryPx: 12, grandPx: 15.5, footerPx: 11, logoMaxWidthMm: 30, logoMaxHeightMm: 11, qtyMm: 8.5, totalMm: 16.5 }
    : { printableMm: 70, basePx: 13.5, titlePx: 19, mutedPx: 12.5, metaPx: 13.25, unitPx: 11.5, summaryPx: 12.75, grandPx: 17.5, footerPx: 11.75, logoMaxWidthMm: 42, logoMaxHeightMm: 13, qtyMm: 11, totalMm: 22 };
  const logoUrl = clean(input.logoUrl) ?? DEFAULT_RECEIPT_LOGO_URL;
  const storeName = clean(input.storeName) ?? clean(input.branchName) ?? "CpIPOS";
  const branchName = clean(input.branchName);
  const modeLabel = normalizeReceiptModeLabel(input.modeLabel);
  const itemRows = input.items.map((item) => `
    <tr>
      <td class="col-name">
        <div class="name">${escapeHtml(item.name)}</div>
        <div class="unit">x ${escapeHtml(money(item.unitPrice, currencyCode))}${item.note ? `<div class="note">หมายเหตุ: ${escapeHtml(item.note)}</div>` : ""}</div>
      </td>
      <td class="col-qty">${escapeHtml(qty(item.quantity))}</td>
      <td class="col-total">${escapeHtml(money(item.lineTotal, currencyCode))}</td>
    </tr>`).join("");
  const logo = `<div class="logo-wrap"><img src="${escapeHtml(logoUrl)}" alt="receipt logo" /></div>`;
  const address = input.storeAddress?.trim() ? `<div class="muted">${escapeHtml(input.storeAddress)}</div>` : "";
  const phone = input.storePhone?.trim() ? `<div class="muted">${escapeHtml(input.storePhone)}</div>` : "";
  const note = input.note?.trim() ? `<div class="hr"></div><div class="note-block"><strong>หมายเหตุ:</strong> ${escapeHtml(input.note)}</div>` : "";
  const tax = Number(input.taxAmount ?? 0);
  const taxLine = Math.abs(tax) >= 0.005 ? `<div class="summary-line is-muted"><span>${L("ภาษี","ພາສີ")}</span><strong>${currencySymbol}${escapeHtml(money(tax, currencyCode))}</strong></div>` : "";
  const cashLines = input.paymentMethod === "cash" ? `
    <div class="summary-line is-aux"><span>${L("รับเงิน","ຮັບເງິນ")}</span><strong>${currencySymbol}${escapeHtml(money(input.cashReceived ?? input.totalAmount, currencyCode))}</strong></div>
    <div class="summary-line is-aux"><span>${L("เงินทอน","ເງິນທອນ")}</span><strong>${currencySymbol}${escapeHtml(money(input.changeAmount ?? 0, currencyCode))}</strong></div>` : "";
  const reprintLine = input.reprint ? `<div class="reprint">สำเนาใบเสร็จ / REPRINT</div>` : "";

  return `<!doctype html>
<html lang="${languageCode}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(storeName)} - ${escapeHtml(input.orderNo)}</title>
  <style>
    @page { size: ${paper}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; width: ${paper}mm; background: #fff; color: #000; font-family: "Noto Sans Lao", "Noto Sans Thai", "Tahoma", "Segoe UI", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { box-sizing: border-box; }
    .receipt { --receipt-paper-width-mm: ${paper}; --receipt-printable-width-mm: ${layout.printableMm}; --receipt-base-font-px: ${layout.basePx}; --receipt-title-font-px: ${layout.titlePx}; --receipt-grand-font-px: ${layout.grandPx}; width: ${layout.printableMm}mm; margin: 0 auto; padding: 1.2mm 0 2mm; font-size: ${layout.basePx}px; line-height: 1.3; }
    .logo-wrap { text-align: center; margin-bottom: .8mm; }
    .logo-wrap img { max-width: ${layout.logoMaxWidthMm}mm; max-height: ${layout.logoMaxHeightMm}mm; object-fit: contain; }
    .head-title { font-weight: 900; font-size: ${layout.titlePx}px; margin-bottom: .6mm; text-align: center; }
    .muted { color: #222; font-size: ${layout.mutedPx}px; font-weight: 700; text-align: center; }
    .reprint { margin: 1mm 0; text-align: center; font-weight: 900; }
    .hr { border-top: 1px dashed #111; margin: 1.4mm 0; }
    .meta-line, .summary-line { display: flex; justify-content: space-between; align-items: baseline; gap: 1mm; margin: .6mm 0; }
    .meta-line { font-size: ${layout.metaPx}px; }
    .meta-line span:last-child, .summary-line strong { text-align: right; }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: .6mm; }
    th, td { padding: .6mm 0; vertical-align: top; }
    .col-name { padding-right: 1mm; overflow-wrap: anywhere; word-break: break-word; }
    .col-qty { width: ${layout.qtyMm}mm; text-align: center; }
    .col-total { width: ${layout.totalMm}mm; text-align: right; white-space: nowrap; }
    .name { font-weight: 700; line-height: 1.25; }
    .unit { font-size: ${layout.unitPx}px; color: #333; }
    .note { margin-top: .35mm; color: #333; font-style: italic; }
    .summary-line { font-size: ${layout.summaryPx}px; }
    .summary-line.is-heading { padding-bottom: .8mm; border-bottom: 1px dashed #111; }
    .summary-line.grand { margin: 1.1mm 0 .9mm; padding: .7mm 0; border-top: 1px solid #111; border-bottom: 1px solid #111; font-size: ${layout.grandPx}px; }
    .summary-line.grand span, .summary-line.grand strong { font-weight: 900; }
    .note-block { font-size: ${layout.unitPx}px; }
    .foot { margin-top: 1.5mm; font-size: ${layout.footerPx}px; text-align: center; }
  </style>
</head>
<body>
  <main class="receipt">
    ${logo}
    <div class="head-title">${escapeHtml(storeName)}</div>
    ${address}${phone}
    ${branchName ? `<div class="muted">${escapeHtml(branchName)}</div>` : ""}
    ${reprintLine}
    <div class="hr"></div>
    <div class="meta-line"><span>${L("ผู้ขาย","ຜູ້ຂາຍ")}</span><span>${escapeHtml(input.sellerName)}</span></div>
    <div class="meta-line"><span>${L("โหมด","ໂໝດ")}</span><span>${escapeHtml(modeLabel)}</span></div>
    <div class="meta-line"><span>${L("เลขที่บิล","ເລກໃບບິນ")}</span><span>${escapeHtml(input.orderNo)}</span></div>
    <div class="meta-line"><span>${L("วันที่","ວັນທີ")}</span><span>${escapeHtml(dateTime(input.paidAtIso, languageCode))}</span></div>
    <div class="hr"></div>
    <table><tbody>${itemRows}</tbody></table>
    <div class="hr"></div>
    <div class="summary-line is-heading"><span>${L("ชำระเงิน","ຊຳລະເງິນ")}</span><strong>${escapeHtml(paymentLabel(input.paymentMethod))}</strong></div>
    <div class="summary-line is-muted"><span>${L("ส่วนลด","ສ່ວນຫຼຸດ")}</span><strong>${currencySymbol}${escapeHtml(money(input.discountAmount, currencyCode))}</strong></div>
    ${taxLine}
    <div class="summary-line grand"><span>${L("ยอดสุทธิ","ຍອດສຸດທິ")}</span><strong>${currencySymbol}${escapeHtml(money(input.totalAmount, currencyCode))}</strong></div>
    ${cashLines}
    ${note}
    <div class="hr"></div>
    <div class="foot">${L("ขอบคุณที่ใช้บริการ","ຂອບໃຈທີ່ໃຊ້ບໍລິການ")}</div>
  </main>
</body>
</html>`;
}
