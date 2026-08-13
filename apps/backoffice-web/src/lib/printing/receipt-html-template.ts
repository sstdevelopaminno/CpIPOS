export type ReceiptHtmlItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  note?: string | null;
};

export type ReceiptHtmlInput = {
  paperWidthMm: 58 | 80;
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

function clean(value: unknown) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";
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

function dateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(parsed);
}

export function renderReceiptHtml(input: ReceiptHtmlInput) {
  const paper = input.paperWidthMm;
  const layout = paper === 58
    ? {
        printableMm: 49,
        basePx: 12.5,
        titlePx: 16,
        mutedPx: 11.4,
        metaPx: 12.25,
        unitPx: 10.5,
        summaryPx: 11.9,
        grandPx: 15.25,
        footerPx: 10.75,
        logoMaxWidthMm: 34,
        logoMaxHeightMm: 14,
        qtyMm: 8.5,
        totalMm: 16.5
      }
    : {
        printableMm: 70,
        basePx: 13.25,
        titlePx: 18.5,
        mutedPx: 12.25,
        metaPx: 13,
        unitPx: 11.25,
        summaryPx: 12.5,
        grandPx: 17,
        footerPx: 11.5,
        logoMaxWidthMm: 48,
        logoMaxHeightMm: 17,
        qtyMm: 11,
        totalMm: 22
      };
  const logoUrl = clean(input.logoUrl) ?? DEFAULT_RECEIPT_LOGO_URL;
  const storeName = clean(input.storeName) ?? clean(input.branchName) ?? "CpIPOS";
  const branchName = clean(input.branchName);
  const itemRows = input.items.map((item) => `
    <tr>
      <td class="col-name">
        <div class="name">${escapeHtml(item.name)}</div>
        <div class="unit">x ${escapeHtml(money(item.unitPrice))}${item.note ? `<div class="note">หมายเหตุ: ${escapeHtml(item.note)}</div>` : ""}</div>
      </td>
      <td class="col-qty">${escapeHtml(qty(item.quantity))}</td>
      <td class="col-total">${escapeHtml(money(item.lineTotal))}</td>
    </tr>`).join("");
  const logo = `<div class="logo-wrap"><img src="${escapeHtml(logoUrl)}" alt="receipt logo" /></div>`;
  const address = input.storeAddress?.trim() ? `<div class="muted">${escapeHtml(input.storeAddress)}</div>` : "";
  const phone = input.storePhone?.trim() ? `<div class="muted">${escapeHtml(input.storePhone)}</div>` : "";
  const note = input.note?.trim() ? `<div class="hr"></div><div class="note-block"><strong>หมายเหตุ:</strong> ${escapeHtml(input.note)}</div>` : "";
  const tax = Number(input.taxAmount ?? 0);
  const taxLine = Math.abs(tax) >= 0.005 ? `<div class="summary-line is-muted"><span>ภาษี</span><strong>฿${escapeHtml(money(tax))}</strong></div>` : "";
  const cashLines = input.paymentMethod === "cash" ? `
    <div class="summary-line is-aux"><span>รับเงิน</span><strong>฿${escapeHtml(money(input.cashReceived ?? input.totalAmount))}</strong></div>
    <div class="summary-line is-aux"><span>เงินทอน</span><strong>฿${escapeHtml(money(input.changeAmount ?? 0))}</strong></div>` : "";
  const reprintLine = input.reprint ? `<div class="reprint">สำเนาใบเสร็จ / REPRINT</div>` : "";

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(storeName)} - ${escapeHtml(input.orderNo)}</title>
  <style>
    @page { size: ${paper}mm auto; margin: 0; }
    html, body {
      margin: 0;
      padding: 0;
      width: ${paper}mm;
      background: #fff;
      color: #000;
      font-family: "Noto Sans Thai", "Noto Sans", "Tahoma", "Segoe UI", sans-serif;
      font-synthesis: none;
      font-kerning: normal;
      letter-spacing: 0;
      word-spacing: 0;
      text-rendering: optimizeLegibility;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    * { box-sizing: border-box; letter-spacing: 0; word-spacing: 0; }
    .receipt {
      --receipt-paper-width-mm: ${paper};
      --receipt-printable-width-mm: ${layout.printableMm};
      --receipt-base-font-px: ${layout.basePx};
      --receipt-title-font-px: ${layout.titlePx};
      --receipt-grand-font-px: ${layout.grandPx};
      width: ${layout.printableMm}mm;
      margin: 0 auto;
      padding: .8mm 0 1.6mm;
      font-size: ${layout.basePx}px;
      line-height: 1.38;
    }
    .logo-wrap { text-align: center; margin-bottom: .35mm; }
    .logo-wrap img { display: block; width: auto; max-width: ${layout.logoMaxWidthMm}mm; max-height: ${layout.logoMaxHeightMm}mm; margin: 0 auto; object-fit: contain; }
    .head-title { font-weight: 800; font-size: ${layout.titlePx}px; line-height: 1.22; margin-bottom: .35mm; text-align: center; }
    .muted { color: #111; font-size: ${layout.mutedPx}px; font-weight: 600; line-height: 1.32; text-align: center; overflow-wrap: break-word; word-break: normal; line-break: auto; }
    .reprint { margin: .7mm 0; text-align: center; font-weight: 800; }
    .hr { border-top: 1px dashed #111; margin: 1mm 0; }
    .meta-line, .summary-line { display: flex; justify-content: space-between; align-items: baseline; gap: 1mm; margin: .45mm 0; }
    .meta-line { font-size: ${layout.metaPx}px; }
    .meta-line span:last-child, .summary-line strong { text-align: right; font-weight: 700; }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: .45mm; }
    th, td { padding: .5mm 0; vertical-align: top; }
    .col-name { padding-right: 1mm; overflow-wrap: break-word; word-break: normal; line-break: auto; }
    .col-qty { width: ${layout.qtyMm}mm; text-align: center; }
    .col-total { width: ${layout.totalMm}mm; text-align: right; white-space: nowrap; }
    .name { font-weight: 700; line-height: 1.32; }
    .unit { font-size: ${layout.unitPx}px; line-height: 1.3; color: #111; }
    .note { margin-top: .3mm; color: #111; font-style: normal; }
    .summary-line { font-size: ${layout.summaryPx}px; }
    .summary-line.is-heading { padding-bottom: .6mm; border-bottom: 1px dashed #111; }
    .summary-line.grand { margin: .8mm 0 .7mm; padding: .65mm 0; border-top: 1px solid #111; border-bottom: 1px solid #111; font-size: ${layout.grandPx}px; }
    .summary-line.grand span, .summary-line.grand strong { font-weight: 800; }
    .note-block { font-size: ${layout.unitPx}px; line-height: 1.32; overflow-wrap: break-word; word-break: normal; line-break: auto; }
    .foot { margin-top: 1.1mm; font-size: ${layout.footerPx}px; text-align: center; }
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
    <div class="meta-line"><span>ผู้ขาย</span><span>${escapeHtml(input.sellerName)}</span></div>
    <div class="meta-line"><span>โหมด</span><span>${escapeHtml(input.modeLabel || "หน้าขาย")}</span></div>
    <div class="meta-line"><span>เลขที่บิล</span><span>${escapeHtml(input.orderNo)}</span></div>
    <div class="meta-line"><span>วันที่</span><span>${escapeHtml(dateTime(input.paidAtIso))}</span></div>
    <div class="hr"></div>
    <table><tbody>${itemRows}</tbody></table>
    <div class="hr"></div>
    <div class="summary-line is-heading"><span>ชำระเงิน</span><strong>${escapeHtml(paymentLabel(input.paymentMethod))}</strong></div>
    <div class="summary-line is-muted"><span>ส่วนลด</span><strong>฿${escapeHtml(money(input.discountAmount))}</strong></div>
    ${taxLine}
    <div class="summary-line grand"><span>ยอดสุทธิ</span><strong>฿${escapeHtml(money(input.totalAmount))}</strong></div>
    ${cashLines}
    ${note}
    <div class="hr"></div>
    <div class="foot">ขอบคุณที่ใช้บริการ</div>
  </main>
</body>
</html>`;
}
