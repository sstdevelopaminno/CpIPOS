/**
 * Isolated 58/80mm optical deposit slip. Do not render this until a
 * backend-confirmed payment ledger entry has been committed and reconciled.
 * The existing fully paid POS/restaurant receipt remains untouched.
 */
import { formatSalesMoney, type SalesCurrencyCode } from "@/lib/pos-money";
import { buildOpticalBillRecallCode, opticalDepositReceiptCanRecall, type OpticalBillSnapshot } from "./optical-deposit-contract";

export type OpticalDepositReceipt80mmInput = {
  paperWidthMm?: 58 | 80;
  bill: OpticalBillSnapshot;
  receiptNumber: string;
  storeName: string;
  branchName: string;
  createdAtIso: string;
  cashierName: string;
  paymentMethod: "cash" | "bank_transfer";
  customerLabel?: string | null;
  qrImageDataUrl?: string | null;
  items: Array<{ description: string; quantity: number; lineTotal: number }>;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function money(value: number, currency: SalesCurrencyCode): string {
  return escapeHtml(formatSalesMoney(value, currency));
}

export function renderOpticalDepositReceipt(input: OpticalDepositReceipt80mmInput): string {
  const paper = input.paperWidthMm ?? 80;
  if(paper!==58 && paper!==80)throw new Error("optical_deposit_receipt_invalid_paper");
  const printableMm = paper===58?48:70;
  const fontPx = paper===58?10:12;
  const headingPx = paper===58?14:17;
  const qrMm = paper===58?25:28;
  const { bill } = input;
  const remaining = bill.totalAmount - bill.paidAmount;
  if (!opticalDepositReceiptCanRecall(bill) || remaining <= 0) {
    throw new Error("optical_deposit_receipt_requires_committed_partial_payment");
  }
  if (!input.receiptNumber.trim() || !input.storeName.trim() || !input.branchName.trim()) {
    throw new Error("optical_deposit_receipt_missing_identity");
  }
  if (!Number.isFinite(Date.parse(input.createdAtIso))) {
    throw new Error("optical_deposit_receipt_invalid_date");
  }
  const recallCode = buildOpticalBillRecallCode(bill);
  if (!recallCode) throw new Error("optical_deposit_receipt_invalid_order_id");
  const currency = bill.currencyCode;
  const validImage = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.qrImageDataUrl ?? "");
  const qr = validImage
    ? `<img class="qr" alt="เลขอ้างอิงเรียกบิลมัดจำ" src="${escapeHtml(input.qrImageDataUrl)}" />`
    : "<p class=\"muted\">กรุณาสแกนเลขอ้างอิงจากเครื่อง POS</p>";
  const rows = input.items.map((item) => {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.lineTotal) || item.lineTotal < 0) {
      throw new Error("optical_deposit_receipt_invalid_item");
    }
    return `<tr><td>${escapeHtml(item.description)}</td><td class="num">${escapeHtml(item.quantity)}</td><td class="num">${money(item.lineTotal,currency)}</td></tr>`;
  }).join("");
  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
    <title>${escapeHtml(input.storeName)} — ใบเสร็จมัดจำ</title>
    <style>
      @page { size: ${paper}mm auto; margin: 0; }
      html,body { width: ${paper}mm; padding: 0; margin: 0; color: #000; background: #fff; font-family: Tahoma, sans-serif; }
      .receipt { width: ${printableMm}mm; margin: auto; padding: 2mm 0; font-size: ${fontPx}px; overflow-wrap: anywhere; }
      h1,h2,p { margin: 0 0 5px; }
      h1 { text-align: center; font-size: ${headingPx}px; }
      h2 { text-align: center; font-size: ${paper===58?12:14}px; }
      .center { text-align: center; }
      .muted { color: #454545; }
      .line { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
      .bold { font-weight: 700; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0; }
      td,th { border-bottom: 1px dashed #666; padding: 4px 0; text-align: left; }
      .num { text-align: right; }
      .qr { display: block; width: ${qrMm}mm; height: ${qrMm}mm; margin: 5px auto; image-rendering: pixelated; }
      .code { text-align: center; font-size: ${paper===58?8:9}px; overflow-wrap: anywhere; }
      hr { border: 0; border-top: 1px dashed #666; }
    </style></head><body><main class="receipt">
      <h1>${escapeHtml(input.storeName)}</h1>
      <h2>ใบเสร็จรับเงินมัดจำ</h2>
      <p class="center">${escapeHtml(input.branchName)}</p>
      <p>เลขที่ใบเสร็จ: ${escapeHtml(input.receiptNumber)}</p>
      <p>เลขบิล: ${escapeHtml(bill.orderId)}</p>
      <p>วันที่: ${escapeHtml(input.createdAtIso)}</p>
      <p>พนักงาน: ${escapeHtml(input.cashierName)}</p>
      ${input.customerLabel ? `<p>ลูกค้า: ${escapeHtml(input.customerLabel)}</p>` : ""}
      <hr><table><thead><tr><th>รายการ</th><th class="num">จำนวน</th><th class="num">ราคา</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="line"><span>ยอดเต็ม</span><strong>${money(bill.totalAmount,currency)}</strong></div>
      <div class="line"><span>รับมัดจำสะสม</span><strong>${money(bill.paidAmount,currency)}</strong></div>
      <div class="line bold"><span>ยอดค้างชำระ</span><strong>${money(remaining,currency)}</strong></div>
      <p>วิธีรับเงินล่าสุด: ${input.paymentMethod==="cash"?"เงินสด":"เงินโอน"}</p>
      <hr><p class="center bold">สแกนที่ POS เพื่อเรียกบิลมาชำระส่วนที่เหลือ</p>
      ${qr}
      <p class="code">${escapeHtml(recallCode)}</p>
      <p class="center muted">การสแกนไม่ใช่การยืนยันการชำระเงิน</p>
    </main></body></html>`;
}

/** Backward-compatible print entry point. Existing 80mm jobs keep their size. */
export function renderOpticalDepositReceipt80mm(input: OpticalDepositReceipt80mmInput): string {
  return renderOpticalDepositReceipt({...input,paperWidthMm:80});
}
