export type PaymentNoticeItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  note?: string | null;
};

export type PaymentNoticeHtmlInput = {
  paperWidthMm: 58 | 80;
  storeName: string;
  branchName: string;
  storeAddress?: string | null;
  storePhone?: string | null;
  logoUrl?: string | null;
  sellerName: string;
  tableLabel?: string | null;
  orderNo: string;
  createdAtIso: string;
  items: PaymentNoticeItem[];
  discountAmount: number;
  taxAmount?: number;
  totalAmount: number;
  accountLabel?: string | null;
  promptPayLabel?: string | null;
  qrDataUri: string;
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

function dateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(parsed);
}

export function renderPaymentNoticeHtml(input: PaymentNoticeHtmlInput) {
  const paper = input.paperWidthMm;
  const layout = paper === 58
    ? { printableMm: 49, basePx: 12.75, titlePx: 16, grandPx: 17, qrMm: 36, logoMaxWidthMm: 30, qtyMm: 8.5, totalMm: 16.5 }
    : { printableMm: 70, basePx: 13.5, titlePx: 19, grandPx: 19, qrMm: 48, logoMaxWidthMm: 42, qtyMm: 11, totalMm: 22 };
  const logoUrl = clean(input.logoUrl) ?? DEFAULT_RECEIPT_LOGO_URL;
  const storeName = clean(input.storeName) ?? clean(input.branchName) ?? "CpIPOS";
  const tableLabel = clean(input.tableLabel);
  const subtotal = input.items.reduce((sum, item) => sum + Number(item.lineTotal ?? 0), 0);
  const itemRows = input.items.map((item) => `
    <tr>
      <td class="col-name"><strong>${escapeHtml(item.name)}</strong><div class="unit">x ${escapeHtml(money(item.unitPrice))}${item.note ? `<div>${escapeHtml(item.note)}</div>` : ""}</div></td>
      <td class="col-qty">${escapeHtml(qty(item.quantity))}</td>
      <td class="col-total">${escapeHtml(money(item.lineTotal))}</td>
    </tr>`).join("");
  const tax = Number(input.taxAmount ?? 0);
  const taxLine = Math.abs(tax) >= 0.005 ? `<div class="summary-line"><span>ภาษี</span><strong>฿${escapeHtml(money(tax))}</strong></div>` : "";

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PAYMENT NOTICE - ${escapeHtml(input.orderNo)}</title>
  <style>
    @page { size: ${paper}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; width: ${paper}mm; background: #fff; color: #000; font-family: "Noto Sans Thai", "Tahoma", "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    .notice { --notice-paper-width-mm: ${paper}; --notice-printable-width-mm: ${layout.printableMm}; width: ${layout.printableMm}mm; margin: 0 auto; padding: 1.2mm 0 2mm; font-size: ${layout.basePx}px; line-height: 1.3; }
    .center { text-align: center; }
    .logo { max-width: ${layout.logoMaxWidthMm}mm; max-height: 12mm; object-fit: contain; }
    .store { font-size: ${layout.titlePx}px; font-weight: 900; }
    .muted { font-size: ${paper === 58 ? 11.5 : 12.5}px; font-weight: 700; color: #222; }
    .title { margin: 1mm 0; padding: 1mm 0; border-top: 1px solid #000; border-bottom: 1px solid #000; font-size: ${layout.titlePx}px; font-weight: 900; }
    .meta, .summary-line { display: flex; justify-content: space-between; gap: 1mm; margin: .55mm 0; }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 1mm 0; }
    th { padding: .6mm 0; border-bottom: 1px solid #000; font-size: ${paper === 58 ? 10.75 : 11.5}px; text-align: left; }
    td { padding: .6mm 0; vertical-align: top; }
    .col-name { padding-right: 1mm; overflow-wrap: anywhere; }
    .col-qty { width: ${layout.qtyMm}mm; text-align: center; }
    .col-total { width: ${layout.totalMm}mm; text-align: right; white-space: nowrap; }
    .unit, .foot { font-size: ${paper === 58 ? 10.75 : 11.5}px; }
    .due { margin: 1mm 0; padding: 1mm 0; border-top: 1px solid #000; border-bottom: 1px solid #000; font-size: ${layout.grandPx}px; font-weight: 900; }
    .due-before-qr { margin-bottom: 1.2mm; padding-bottom: 1mm; }
    .qr-wrap { margin: 1.2mm 0 1mm; line-height: 0; }
    .qr { display: block; width: ${layout.qrMm}mm; height: ${layout.qrMm}mm; margin: 0 auto; object-fit: contain; image-rendering: pixelated; }
    .scan { font-weight: 900; margin-top: .8mm; }
    .hr { border-top: 1px dashed #111; margin: 1.2mm 0; }
  </style>
</head>
<body>
  <main class="notice">
    <div class="center"><img class="logo" src="${escapeHtml(logoUrl)}" alt="logo" /></div>
    <div class="center store">${escapeHtml(storeName)}</div>
    ${input.storeAddress ? `<div class="center muted">${escapeHtml(input.storeAddress)}</div>` : ""}
    ${input.storePhone ? `<div class="center muted">${escapeHtml(input.storePhone)}</div>` : ""}
    <div class="center muted">${escapeHtml(input.branchName)}</div>
    <div class="center title"><div>ใบแจ้งชำระเงิน</div><div>PAYMENT NOTICE / รอชำระ</div></div>
    <div class="meta"><span>ผู้ขาย</span><strong>${escapeHtml(input.sellerName)}</strong></div>
    ${tableLabel ? `<div class="meta"><span>โต๊ะ</span><strong>${escapeHtml(tableLabel)}</strong></div>` : ""}
    <div class="meta"><span>เลขที่บิล</span><strong>${escapeHtml(input.orderNo)}</strong></div>
    <div class="meta"><span>วันที่</span><strong>${escapeHtml(dateTime(input.createdAtIso))}</strong></div>
    <div class="hr"></div>
    <table><thead><tr><th class="col-name">รายการ</th><th class="col-qty">จำนวน</th><th class="col-total">รวม</th></tr></thead><tbody>${itemRows}</tbody></table>
    <div class="hr"></div>
    <div class="summary-line"><span>ยอดรวมก่อนส่วนลด</span><strong>฿${escapeHtml(money(subtotal))}</strong></div>
    <div class="summary-line"><span>ส่วนลด</span><strong>฿${escapeHtml(money(input.discountAmount))}</strong></div>
    ${taxLine}
    <div class="summary-line"><span>ชำระโดย</span><strong>โอนเงิน</strong></div>
    <div class="summary-line due due-before-qr"><span>ยอดที่ต้องชำระ</span><strong>฿${escapeHtml(money(input.totalAmount))}</strong></div>
    <div class="center qr-wrap"><img class="qr" src="${escapeHtml(input.qrDataUri)}" alt="Payment QR" /></div>
    <div class="center scan">สแกน QR เพื่อชำระเงิน</div>
    <div class="center due">฿${escapeHtml(money(input.totalAmount))}</div>
    <div class="hr"></div>
    <div class="center foot">ใบแจ้งนี้ใช้สำหรับชำระเงินเท่านั้น</div>
    <div class="center foot">ยังไม่ใช่ใบเสร็จรับเงิน</div>
    <div class="center foot">กรุณารอพนักงานยืนยันการชำระเงิน</div>
  </main>
</body>
</html>`;
}
