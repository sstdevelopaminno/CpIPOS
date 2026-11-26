import {receiptDateText,type ReceiptVisibility} from "@/lib/printing/custom-receipt-layout";
import { parsePosItemNotes } from "@/lib/pos-item-notes";

export type ReceiptHtmlItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  note?: string | null;
  /** Optional CUSTOM display values; ordinary POS receipts use original fields. */
  sku?: string | null;
  quantityDisplay?: string | null;
  unitPriceSuffix?: string | null;
};

export type ReceiptHtmlInput = {
  paperWidthMm: 58 | 80;
  visibility?:ReceiptVisibility;
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
  sellerLabel?: string | null;
  documentHeading?: string | null;
  documentNotice?: string | null;
  voidWarning?: string | null;
  footerText?: string | null;
  paymentHeading?: string | null;
  /** Suppress tender received/change rows when the business pays out, not in. */
  hideCashTenderBreakdown?: boolean;
  /** Scoped thermal layout: only CUSTOM Recycling uses the compact 58/80mm typography. */
  compactRecycling?: boolean;
  /** Printer-specific calibration: center narrow Recycling thermal content on 58/80mm media. */
  centerThermalContent?: boolean;
  /** Calibrated X offset in mm for an explicitly bound Recycling Windows printer. */
  thermalOffsetMm?: number;
  /** Explicit Windows Recycling printer calibration, not the nominal 80mm paper width. */
  thermalPrintableWidthMm?: number;
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

function paymentLabel(method: string, lang: "th" | "en" | "lo" = "th") {
  const labels: Record<string, Record<"th" | "en" | "lo", string>> = {
    cash: { th: "เงินสด", en: "Cash", lo: "ເງິນສົດ" },
    bank_transfer: { th: "โอนเงิน", en: "Bank transfer", lo: "ໂອນເງິນ" },
    card: { th: "บัตร", en: "Card", lo: "ບັດ" },
    credit: { th: "เครดิต/ค้างชำระ", en: "Credit / payable", lo: "ເຊື່ອ / ຄ້າງຊຳລະ" }
  };
  return labels[method]?.[lang] ?? method ?? (lang === "lo" ? "ຊຳລະເງິນ" : lang === "en" ? "Payment" : "ชำระเงิน");
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
  const L = (thai: string, english: string, lao: string) => languageCode === "lo" ? lao : languageCode === "en" ? english : thai;
  const paper = input.paperWidthMm;
  const v=input.visibility;
  const when=v?receiptDateText(input.paidAtIso,v,languageCode):dateTime(input.paidAtIso,languageCode);
  const regularLayout = paper === 58
    ? { printableMm: 45, basePx: 12.75, titlePx: 16.5, mutedPx: 11.75, metaPx: 12.5, unitPx: 10.75, summaryPx: 12, grandPx: 15.5, footerPx: 11, logoMaxWidthMm: 30, logoMaxHeightMm: 11, qtyMm: 8.5, totalMm: 16.5 }
    : { printableMm: 56, basePx: 13.5, titlePx: 19, mutedPx: 12.5, metaPx: 13.25, unitPx: 11.5, summaryPx: 12.75, grandPx: 17.5, footerPx: 11.75, logoMaxWidthMm: 42, logoMaxHeightMm: 13, qtyMm: 11, totalMm: 22 };
  // Recycling has a denser receipt than standard POS. Use balanced type sizes
  // and a two-line item layout on 58/80mm, without changing other POS packages.
  const recyclingLayout = paper === 58
    ? { printableMm: 45, basePx: 11.5, titlePx: 13.5, mutedPx: 10, metaPx: 10.8, unitPx: 10, summaryPx: 11.5, grandPx: 15.5, footerPx: 10, logoMaxWidthMm: 27, logoMaxHeightMm: 11, qtyMm: 8.5, totalMm: 16.5 }
    : { printableMm: 56, basePx: 12.5, titlePx: 15.5, mutedPx: 11.25, metaPx: 11.8, unitPx: 11, summaryPx: 12.5, grandPx: 17, footerPx: 11, logoMaxWidthMm: 39, logoMaxHeightMm: 13, qtyMm: 11, totalMm: 22 };
  // Most 80mm thermal mechanisms expose less than 80mm of printable pixels.
  // Expand ONLY a calibrated Recycling Windows printer, up to a conservative
  // 70mm ink area with room for driver clipping; other tenants are unchanged.
  const calibratedRecyclingWidthMm =
    input.compactRecycling && input.centerThermalContent && paper === 80 &&
    typeof input.thermalPrintableWidthMm === "number" &&
    Number.isFinite(input.thermalPrintableWidthMm) &&
    input.thermalPrintableWidthMm >= 56 && input.thermalPrintableWidthMm <= 70
      ? input.thermalPrintableWidthMm : null;
  const layout = input.compactRecycling
    ? { ...recyclingLayout, printableMm: calibratedRecyclingWidthMm ?? recyclingLayout.printableMm }
    : regularLayout;
  // XP-80T 80mm roll prints only approximately 72mm; leave additional room for Windows driver offset.
  // Keep font sizes and all monetary values unchanged; wrap long lines instead of clipping.
  const thermalOffsetMm = Number.isFinite(input.thermalOffsetMm)
    ? Math.max(-6, Math.min(6, Number(input.thermalOffsetMm))) : 0;
  const printableLeftMm = input.compactRecycling && input.centerThermalContent
    ? Math.max(0, (paper - layout.printableMm) / 2 + thermalOffsetMm) : 1;
  const logoUrl = clean(input.logoUrl) ?? DEFAULT_RECEIPT_LOGO_URL;
  const storeName = clean(input.storeName) ?? clean(input.branchName) ?? "CpIPOS";
  const branchName = clean(input.branchName);
  const rawModeLabel = normalizeReceiptModeLabel(input.modeLabel);
  const modeLabel = rawModeLabel === "หน้าขาย"
    ? L("หน้าขาย", "Sales", "ໜ້າຂາຍ")
    : rawModeLabel === "ใบเสร็จย้อนหลัง"
      ? L("ใบเสร็จย้อนหลัง", "Receipt history", "ໃບຮັບເງິນຍ້ອນຫຼັງ")
      : rawModeLabel;
  const itemRows = input.items.map((item) => {
    if (input.compactRecycling) {
      return `<tr class="recycling-item"><td colspan="3">
        <div class="name">${escapeHtml(item.name)}</div>
        ${item.sku?.trim() ? `<div class="unit">รหัส ${escapeHtml(item.sku)}</div>` : ""}
        <div class="recycling-item-detail">
          <span>${escapeHtml(item.quantityDisplay || qty(item.quantity))} ·
            ${escapeHtml(money(item.unitPrice, currencyCode))}${item.unitPriceSuffix ? ` ${escapeHtml(item.unitPriceSuffix)}` : ""}</span>
          <strong>${escapeHtml(money(item.lineTotal, currencyCode))}</strong>
        </div>
      </td></tr>`;
    }
    const parsedNotes = parsePosItemNotes(item.note);
    const optionParts = parsedNotes.optionNotes.split(",").map((part) => part.trim()).filter(Boolean);
    // A single modifier must remain visible when the cashier also entered
    // a separate item detail. The old length > 1 branch silently hid it.
    const optionRows = parsedNotes.detailNote || optionParts.length > 1
      ? optionParts.map((part) => `<div class="choice">+ ${escapeHtml(part)}</div>`).join("")
      : "";
    const legacyNote = !parsedNotes.detailNote && optionParts.length === 1 ? optionParts[0] : "";
    const detailRow = parsedNotes.detailNote
      ? `<div class="note"><strong>${L("รายละเอียด", "Details", "ລາຍລະອຽດ")}:</strong> ${escapeHtml(parsedNotes.detailNote)}</div>`
      : legacyNote
        ? `<div class="note">${L("หมายเหตุ", "Note", "ໝາຍເຫດ")}: ${escapeHtml(legacyNote)}</div>`
        : "";
    return `
    <tr>
      <td class="col-name">
        <div class="name">${escapeHtml(item.name)}</div>
        ${item.sku?.trim() ? `<div class="unit">${escapeHtml(item.sku)}</div>` : ""}
        <div class="unit">x ${escapeHtml(money(item.unitPrice, currencyCode))}${item.unitPriceSuffix ? ` ${escapeHtml(item.unitPriceSuffix)}` : ""}</div>
        ${optionRows}
        ${detailRow}
      </td>
      <td class="col-qty">${escapeHtml(item.quantityDisplay || qty(item.quantity))}</td>
      <td class="col-total">${escapeHtml(money(item.lineTotal, currencyCode))}</td>
    </tr>`;
  }).join("");
  const logo = `<div class="logo-wrap"><img src="${escapeHtml(logoUrl)}" alt="receipt logo" /></div>`;
  const address = input.storeAddress?.trim() ? `<div class="muted">${escapeHtml(input.storeAddress)}</div>` : "";
  const phone = input.storePhone?.trim() ? `<div class="muted">${escapeHtml(input.storePhone)}</div>` : "";
  const note = input.note?.trim() ? `<div class="hr"></div><div class="note-block"><strong>${L("หมายเหตุ", "Note", "ໝາຍເຫດ")}:</strong> ${escapeHtml(input.note)}</div>` : "";
  const tax = Number(input.taxAmount ?? 0);
  const taxLine = Math.abs(tax) >= 0.005 ? `<div class="summary-line is-muted"><span>${L("ภาษี","Tax","ພາສີ")}</span><strong>${currencySymbol}${escapeHtml(money(tax, currencyCode))}</strong></div>` : "";
  const cashLines = input.paymentMethod === "cash" && input.hideCashTenderBreakdown !== true ? `
    <div class="summary-line is-aux"><span>${L("รับเงิน","Cash received","ຮັບເງິນ")}</span><strong>${currencySymbol}${escapeHtml(money(input.cashReceived ?? input.totalAmount, currencyCode))}</strong></div>
    <div class="summary-line is-aux"><span>${L("เงินทอน","Change","ເງິນທອນ")}</span><strong>${currencySymbol}${escapeHtml(money(input.changeAmount ?? 0, currencyCode))}</strong></div>` : "";
  const reprintLine = input.reprint ? `<div class="reprint">${L("สำเนาใบเสร็จ", "Receipt copy", "ສຳເນົາໃບຮັບເງິນ")} / REPRINT</div>` : "";

  return `<!doctype html>
<html lang="${languageCode}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${v?.shop===false?"":escapeHtml(storeName)}${v?.number===false?"":" - "+escapeHtml(input.orderNo)}</title>
  <style>
    @page { size: ${paper}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; width: ${paper}mm; background: #fff; color: #000; font-family: "Noto Sans Lao", "Noto Sans Thai", "Tahoma", "Segoe UI", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { box-sizing: border-box; }
    .receipt { --receipt-paper-width-mm: ${paper}; --receipt-printable-width-mm: ${layout.printableMm}; --receipt-base-font-px: ${layout.basePx}; --receipt-title-font-px: ${layout.titlePx}; --receipt-grand-font-px: ${layout.grandPx}; width: ${layout.printableMm}mm; margin: 0 0 0 ${printableLeftMm}mm; padding: 1.2mm 0 2mm; font-size: ${layout.basePx}px; line-height: 1.3; }
    .logo-wrap { text-align: center; margin-bottom: .8mm; }
    .logo-wrap img { max-width: ${layout.logoMaxWidthMm}mm; max-height: ${layout.logoMaxHeightMm}mm; object-fit: contain; }
    .head-title { font-weight: 900; font-size: ${layout.titlePx}px; margin-bottom: .6mm; text-align: center; }
    .muted { color: #222; font-size: ${layout.mutedPx}px; font-weight: 700; text-align: center; }
    .reprint { margin: 1mm 0; text-align: center; font-weight: 900; }
    .hr { border-top: 1px dashed #111; margin: 1.4mm 0; }
    .meta-line, .summary-line { display: table; width: 100%; table-layout: fixed; border-collapse: collapse; margin: .6mm 0; }
    .meta-line > span, .summary-line > span, .summary-line > strong { display: table-cell; vertical-align: baseline; width: 50%; }
    .meta-line > span:last-child, .summary-line > strong { text-align: right; overflow-wrap: anywhere; word-break: break-word; }
    .meta-line { font-size: ${layout.metaPx}px; }
    .meta-line span:last-child, .summary-line strong { text-align: right; }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: .6mm; }
    th, td { padding: .6mm 0; vertical-align: top; }
    .col-name { padding-right: 1mm; overflow-wrap: anywhere; word-break: break-word; }
    .col-qty { width: ${layout.qtyMm}mm; text-align: center; }
    .col-total { width: ${layout.totalMm}mm; text-align: right; overflow-wrap: anywhere; word-break: break-word; }
    .name { font-weight: 700; line-height: 1.25; }
    .unit { font-size: ${layout.unitPx}px; color: #333; }
    .choice { margin-top: .25mm; color: #222; font-size: ${layout.unitPx}px; font-weight: 700; }\n    .note { margin-top: .35mm; color: #333; font-style: italic; white-space: pre-line; }
    .summary-line { font-size: ${layout.summaryPx}px; }
    .summary-line strong { overflow-wrap: anywhere; word-break: break-word; }
    .summary-line.is-heading { padding-bottom: .8mm; border-bottom: 1px dashed #111; }
    .summary-line.grand { margin: 1.1mm 0 .9mm; padding: .7mm 0; border-top: 1px solid #111; border-bottom: 1px solid #111; font-size: ${layout.grandPx}px; }
    .summary-line.grand span, .summary-line.grand strong { font-weight: 900; }
    .note-block { font-size: ${layout.unitPx}px; }
    .foot { margin-top: 1.5mm; font-size: ${layout.footerPx}px; text-align: center; }
    ${input.compactRecycling ? `
    /* CUSTOM Recycling thermal-only: keep 58/80mm values and labels legible.
       Ordinary POS receipts never load this stylesheet. */
    .receipt-compact { line-height:1.38; overflow-wrap:anywhere; }
    .receipt-compact .head-title { line-height:1.22; overflow-wrap:anywhere; margin-bottom:1mm; }
    .receipt-compact .document-heading { margin-top:1.4mm; font-size:${layout.titlePx}px; }
    .receipt-compact .muted { font-weight:500; line-height:1.3; overflow-wrap:anywhere; }
    .receipt-compact .logo-wrap { margin-bottom:1.5mm; }
    .receipt-compact .hr { margin:1.5mm 0; }
    .receipt-compact .meta-line { display:grid; grid-template-columns:29% minmax(0,1fr); align-items:start; gap:1mm; margin:1mm 0; line-height:1.35; }
    .receipt-compact .meta-line > span { display:block; width:auto; min-width:0; }
    .receipt-compact .meta-line > span:last-child { text-align:right; overflow-wrap:anywhere; }
    .receipt-compact .receipt-id-line { display:block; }
    .receipt-compact .receipt-id-line > span { width:100%; display:block; }
    .receipt-compact .receipt-id-line > span:last-child { margin-top:.2mm; text-align:left; font-size:${layout.unitPx}px; overflow-wrap:anywhere; word-break:break-all; }
    .receipt-compact .recycling-item td { width:100%; padding:1.2mm 0; border-bottom:1px dotted #888; overflow-wrap:anywhere; }
    .receipt-compact .recycling-item .name { font-size:${layout.basePx}px; }
    .receipt-compact .recycling-item .unit { font-size:${layout.unitPx}px; }
    .receipt-compact .recycling-item-detail { display:flex; justify-content:space-between; align-items:baseline; gap:1mm; margin-top:.45mm; font-size:${layout.unitPx}px; }
    .receipt-compact .recycling-item-detail span { min-width:0; overflow-wrap:anywhere; }
    .receipt-compact .recycling-item-detail strong { flex-shrink:0; white-space:nowrap; font-size:${layout.basePx}px; font-variant-numeric:tabular-nums; }
    .receipt-compact .summary-line.grand { display:flex; justify-content:space-between; align-items:baseline; gap:1.5mm; line-height:1.3; padding:1mm 0; }
    .receipt-compact .summary-line.grand > span,
    .receipt-compact .summary-line.grand > strong { display:block; width:auto; min-width:0; }
    .receipt-compact .summary-line.grand > strong { flex-shrink:0; white-space:nowrap; font-variant-numeric:tabular-nums; }
    .receipt-compact .foot { line-height:1.35; overflow-wrap:anywhere; }
    ` : ""}
  </style>
</head>
<body>
  <main class="receipt${input.compactRecycling ? " receipt-compact" : ""}">
    ${v?.logo===false?"":logo}
    ${v?.shop===false?"":`<div class="head-title">${escapeHtml(storeName)}</div>`}
    ${v?.address===false?"":address}${v?.phone===false?"":phone}
    ${branchName && v?.branch!==false ? `<div class="muted">${escapeHtml(branchName)}</div>` : ""}
    ${reprintLine}
    ${input.documentHeading?.trim() ? `<div class="head-title document-heading">${escapeHtml(input.documentHeading)}</div>` : ""}
    ${input.voidWarning?.trim() ? `<div class="reprint" style="border:2px solid #111;padding:2mm;font-weight:900;">${escapeHtml(input.voidWarning)}</div>` : ""}
    ${input.documentNotice?.trim() ? `<div class="muted">${escapeHtml(input.documentNotice)}</div>` : ""}
    <div class="hr"></div>
    ${v?.seller===false?"":`<div class="meta-line"><span>${escapeHtml(input.sellerLabel ?? L("ผู้ขาย","Seller","ຜູ້ຂາຍ"))}</span><span>${escapeHtml(input.sellerName)}</span></div>`}
    ${v?.mode===false?"":`<div class="meta-line"><span>${L("โหมด","Mode","ໂໝດ")}</span><span>${escapeHtml(modeLabel)}</span></div>`}
    ${v?.number===false?"":`<div class="meta-line receipt-id-line"><span>${L("เลขที่บิล","Bill no.","ເລກໃບບິນ")}</span><span>${escapeHtml(input.orderNo)}</span></div>`}
    ${when?`<div class="meta-line"><span>${v?.date===false?L("เวลา","Time","ເວລາ"):L("วันที่","Date","ວັນທີ")}</span><span>${escapeHtml(when)}</span></div>`:""}
    <div class="hr"></div>
    <table><tbody>${itemRows}</tbody></table>
    <div class="hr"></div>
    <div class="summary-line is-heading"><span>${escapeHtml(input.paymentHeading ?? L("ชำระเงิน","Payment","ຊຳລະເງິນ"))}</span><strong>${escapeHtml(paymentLabel(input.paymentMethod, languageCode))}</strong></div>
    ${!input.compactRecycling || Number(input.discountAmount) !== 0 ? `<div class="summary-line is-muted"><span>${L("ส่วนลด","Discount","ສ່ວນຫຼຸດ")}</span><strong>${currencySymbol}${escapeHtml(money(input.discountAmount, currencyCode))}</strong></div>` : ""}
    ${taxLine}
    <div class="summary-line grand"><span>${L("ยอดสุทธิ","Net total","ຍອດສຸດທິ")}</span><strong>${currencySymbol}${escapeHtml(money(input.totalAmount, currencyCode))}</strong></div>
    ${cashLines}
    ${note}
    <div class="hr"></div>
    ${v?.footer===false&&input.paymentMethod!=="credit"?"":`<div class="foot">${escapeHtml(input.footerText ?? L("ขอบคุณที่ใช้บริการ","Thank you for your purchase","ຂອບໃຈທີ່ໃຊ້ບໍລິການ"))}</div>`}
  </main>
</body>
</html>`;
}
