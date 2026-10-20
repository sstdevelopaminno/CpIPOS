/**
 * Isolated 80mm optical deposit slip preview. Do not render this until a
 * backend-confirmed payment ledger entry has been committed and reconciled.
 * The existing fully paid POS/restaurant receipt remains untouched.
 */
import { formatSalesMoney, type SalesCurrencyCode } from "@/lib/pos-money";
import {buildOpticalPickupBarcode,type OpticalBillSnapshot} from "./optical-deposit-contract";
import {opticalCode128Svg} from "./optical-code128-barcode";

export type OpticalDepositReceipt80mmInput = {
  bill: OpticalBillSnapshot;
  receiptNumber: string;
  storeName: string;
  branchName: string;
  createdAtIso: string;
  cashierName: string;
  paymentMethod: "cash" | "bank_transfer";
  customerLabel?: string | null;
  receiptWidthMm?: 58 | 80;
  pickupDateIso?: string | null;
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

export function renderOpticalDepositReceipt80mm(input: OpticalDepositReceipt80mmInput): string {
  const { bill } = input;
  const remaining = bill.totalAmount - bill.paidAmount;
  if(bill.paidAmount<=0||bill.paidAmount>bill.totalAmount||
     bill.status==="cancelled"||bill.status==="void"){
    throw new Error("optical_receipt_requires_confirmed_payment");
  }
  if (!input.receiptNumber.trim() || !input.storeName.trim() || !input.branchName.trim()) {
    throw new Error("optical_deposit_receipt_missing_identity");
  }
  if (!Number.isFinite(Date.parse(input.createdAtIso))) {
    throw new Error("optical_deposit_receipt_invalid_date");
  }
  const recallCode = buildOpticalPickupBarcode(bill.orderId);
  if (!recallCode) throw new Error("optical_receipt_invalid_order_id");
  const currency = bill.currencyCode;
  const barcodeSvg=opticalCode128Svg(recallCode);
  const barcodeData="data:image/svg+xml;base64,"+Buffer.from(barcodeSvg,"utf8").toString("base64");
  const width=input.receiptWidthMm===58?58:80;
  const rows = input.items.map((item) => {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.lineTotal) || item.lineTotal < 0) {
      throw new Error("optical_deposit_receipt_invalid_item");
    }
    return `<tr><td>${escapeHtml(item.description)}</td><td class="num">${escapeHtml(item.quantity)}</td><td class="num">${money(item.lineTotal,currency)}</td></tr>`;
  }).join("");
  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
    <title>${escapeHtml(input.storeName)} — ${remaining>0?"ใบเสร็จมัดจำ":"ใบเสร็จรับเงินเต็มจำนวน"}</title>
    <style>
      @page { size: ${width}mm auto; margin: 0; }
      html,body { width: ${width}mm; padding: 0; margin: 0; color: #000; background: #fff; font-family: Tahoma, sans-serif; }
      .receipt { width: ${width-8}mm; margin: auto; padding: 2mm 0; font-size: 12px; overflow-wrap: anywhere; }
      h1,h2,p { margin: 0 0 5px; }
      h1 { text-align: center; font-size: 17px; }
      h2 { text-align: center; font-size: 14px; }
      .center { text-align: center; }
      .muted { color: #454545; }
      .line { display: flex; justify-content: space-between; gap: 8px; margin: 3px 0; }
      .bold { font-weight: 700; }
      table { width: 100%; border-collapse: collapse; margin: 8px 0; }
      td,th { border-bottom: 1px dashed #666; padding: 4px 0; text-align: left; }
      .num { text-align: right; }
      .barcode { display: block; width: 100%; max-height: 22mm; margin: 5px auto; object-fit: contain; image-rendering: crisp-edges; }
      @media print { .barcode { break-inside: avoid; } }
      .code { text-align: center; font-size: 9px; overflow-wrap: anywhere; }
      hr { border: 0; border-top: 1px dashed #666; }
    </style></head><body><main class="receipt">
      <h1>${escapeHtml(input.storeName)}</h1>
      <h2>${remaining>0?"ใบเสร็จรับเงินมัดจำ":"ใบเสร็จชำระเต็มจำนวน"}</h2>
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
      <div class="line bold"><span>ยอดค้างชำระ</span><strong>${money(Math.max(0,remaining),currency)}</strong></div>
      ${input.pickupDateIso?`<p class="bold">นัดรับ: ${escapeHtml(input.pickupDateIso.slice(0,10))}</p>`:""}
      <p>วิธีรับเงินล่าสุด: ${input.paymentMethod==="cash"?"เงินสด":"เงินโอน"}</p>
      <hr><p class="center bold">บาร์โค้ดใบสั่งงาน — สแกน ณ วันที่นัดรับ</p>
      <img class="barcode" alt="บาร์โค้ดใบงาน" src="${barcodeData}" />
      <p class="code">${escapeHtml(recallCode)}</p>
      <p class="center muted">${remaining>0?"สแกนเพื่อเรียกยอดค้างชำระ ไม่ใช่หลักฐานการจ่าย":"ชำระเต็มแล้ว ไม่มีการเรียกเก็บยอดซ้ำ"}</p>
    </main></body></html>`;
}
