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
  const printable = paper === 58 ? 48 : 70;
  const fontSize = paper === 58 ? 11 : 12;
  const itemRows = input.items.map((item) => `
    <tr>
      <td class="col-name">
        <div class="name">${escapeHtml(item.name)}</div>
        <div class="unit">x ${escapeHtml(money(item.unitPrice))}${item.note ? `<div class="note">หมายเหตุ: ${escapeHtml(item.note)}</div>` : ""}</div>
      </td>
      <td class="col-qty">${escapeHtml(qty(item.quantity))}</td>
      <td class="col-total">${escapeHtml(money(item.lineTotal))}</td>
    </tr>`).join("");
  const logo = input.logoUrl?.trim() ? `<div class="logo-wrap"><img src="${escapeHtml(input.logoUrl)}" alt="logo" /></div>` : "";
  const address = input.storeAddress?.trim() ? `<div class="muted">${escapeHtml(input.storeAddress)}</div>` : "";
  const phone = input.storePhone?.trim() ? `<div class="muted">${escapeHtml(input.storePhone)}</div>` : "";
  const note = input.note?.trim() ? `<div class="hr"></div><div class="note-block"><strong>หมายเหตุ:</strong> ${escapeHtml(input.note)}</div>` : "";
  const tax = Number(input.taxAmount ?? 0);
  const taxLine = Math.abs(tax) >= 0.005 ? `<div class="summary-line is-muted"><span>ภาษี</span><strong>฿${escapeHtml(money(tax))}</strong></div>` : "";
  const cashLines = input.paymentMethod === "cash" ? `
    <div class="summary-line is-aux"><span>รับเงินจากลูกค้า</span><strong>฿${escapeHtml(money(input.cashReceived ?? input.totalAmount))}</strong></div>
    <div class="summary-line is-aux"><span>เงินทอน</span><strong>฿${escapeHtml(money(input.changeAmount ?? 0))}</strong></div>` : "";
  const reprintLine = input.reprint ? `<div class="reprint">สำเนาใบเสร็จ / REPRINT</div>` : "";

  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(input.storeName)} - ${escapeHtml(input.orderNo)}</title>
  <style>
    @page { size: ${paper}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; width: ${paper}mm; background: #fff; color: #000; font-family: "Noto Sans Thai", "Tahoma", "Segoe UI", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    * { box-sizing: border-box; }
    .receipt { width: ${printable}mm; margin: 0 auto; padding: 1.2mm 0 2mm; font-size: ${fontSize}px; line-height: 1.28; }
    .logo-wrap { text-align: center; margin-bottom: .8mm; }
    .logo-wrap img { max-width: ${paper === 58 ? 28 : 38}mm; max-height: 10mm; object-fit: contain; }
    .head-title { font-weight: 900; font-size: ${paper === 58 ? 14 : 16}px; margin-bottom: .6mm; text-align: center; }
    .muted { color: #222; font-size: ${paper === 58 ? 10 : 11}px; font-weight: 700; text-align: center; }
    .reprint { margin: 1mm 0; text-align: center; font-weight: 900; }
    .hr { border-top: 1px dashed #111; margin: 1.4mm 0; }
    .meta-line, .summary-line { display: flex; justify-content: space-between; align-items: baseline; gap: 1mm; margin: .6mm 0; }
    .meta-line span:last-child, .summary-line strong { text-align: right; }
    table { width: 100%; border-collapse: collapse; margin-top: .6mm; }
    th, td { padding: .6mm 0; vertical-align: top; }
    .col-qty { width: ${paper === 58 ? 8 : 10}mm; text-align: center; }
    .col-total { width: ${paper === 58 ? 16 : 20}mm; text-align: right; white-space: nowrap; }
    .name { font-weight: 700; line-height: 1.25; }
    .unit { font-size: ${paper === 58 ? 9.5 : 10.5}px; color: #333; }
    .note { margin-top: .35mm; color: #333; font-style: italic; }
    .summary-line { font-size: ${paper === 58 ? 10 : 11}px; }
    .summary-line.is-heading { padding-bottom: .8mm; border-bottom: 1px dashed #111; }
    .summary-line.grand { margin: 1.1mm 0 .9mm; padding: .7mm 0; border-top: 1px solid #111; border-bottom: 1px solid #111; font-size: ${paper === 58 ? 13 : 15}px; }
    .summary-line.grand span, .summary-line.grand strong { font-weight: 900; }
    .note-block { font-size: ${paper === 58 ? 9.5 : 10.5}px; }
    .foot { margin-top: 1.5mm; font-size: 10px; text-align: center; }
  </style>
</head>
<body>
  <main class="receipt">
    ${logo}
    <div class="head-title">${escapeHtml(input.storeName || input.branchName)}</div>
    ${address}${phone}
    <div class="muted">${escapeHtml(input.branchName)}</div>
    ${reprintLine}
    <div class="hr"></div>
    <div class="meta-line"><span>ชื่อผู้ขาย</span><span>${escapeHtml(input.sellerName)}</span></div>
    <div class="meta-line"><span>โหมด</span><span>${escapeHtml(input.modeLabel || "หน้าขาย")}</span></div>
    <div class="meta-line"><span>เลขที่บิล</span><span>${escapeHtml(input.orderNo)}</span></div>
    <div class="meta-line"><span>วันที่</span><span>${escapeHtml(dateTime(input.paidAtIso))}</span></div>
    <div class="hr"></div>
    <table><tbody>${itemRows}</tbody></table>
    <div class="hr"></div>
    <div class="summary-line is-heading"><span>ชำระเงิน</span><strong>${escapeHtml(paymentLabel(input.paymentMethod))}</strong></div>
    <div class="summary-line is-muted"><span>ส่วนลด</span><strong>฿${escapeHtml(money(input.discountAmount))}</strong></div>
    ${taxLine}
    <div class="summary-line grand"><span>ยอดที่ต้องชำระ</span><strong>฿${escapeHtml(money(input.totalAmount))}</strong></div>
    ${cashLines}
    ${note}
    <div class="hr"></div>
    <div class="foot">CpIPOS</div>
  </main>
</body>
</html>`;
}
