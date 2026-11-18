/** Pure A5/A4 office document layout shared by Accountant and POS receipt history.
 * Data must come from an authenticated, verified source document.
 */
export type OfficePaperSize = "A5" | "A4";
type Line = { name: string; quantity: number; unitPrice: number; total: number; note: string };
export type OfficeDocumentInput = {
  paper: OfficePaperSize;
  kind: "receipt" | "tax";
  number: string;
  issuedAt: string;
  seller: { name: string; taxId?: string; address: string; phone?: string };
  buyer: { name: string; taxId?: string; address?: string };
  items: Line[];
  discount: number;
  tax: number;
  total: number;
  paymentMethod?: string;
  note?: string;
  currency: "THB" | "LAK";
};

function escapeHtml(raw: unknown): string {
  return String(raw ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
function money(value: number, currency: "THB" | "LAK"): string {
  const digits = currency === "LAK" ? 0 : 2;
  return Number.isFinite(value)
    ? value.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";
}
function dateLabel(raw: string): string {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw :
    date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
}

/** Reusable A5/A4 document HTML for POS/accountant adapters. No database mutation. */
export function renderOfficeDocumentHtml(input: OfficeDocumentInput): string {
  const paper = input.paper === "A4" ? "A4" : "A5";
  const title = input.kind === "tax" ? "ใบกำกับภาษี" : "ใบเสร็จรับเงิน";
  const english = input.kind === "tax" ? "TAX INVOICE" : "RECEIPT";
  const rows = input.items.map((item, index) => `
    <tr><td class="center">${index + 1}</td>
      <td class="description"><strong>${escapeHtml(item.name)}</strong>
        ${item.note ? `<div class="muted">${escapeHtml(item.note)}</div>` : ""}</td>
      <td class="right">${escapeHtml(String(item.quantity))}</td>
      <td class="right">${escapeHtml(money(item.unitPrice, input.currency))}</td>
      <td class="right">${escapeHtml(money(item.total, input.currency))}</td>
    </tr>`).join("");
  const subtotal = input.items.reduce((sum, item) => sum + item.total, 0);
  const seller = input.seller;
  const buyer = input.buyer;
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} ${escapeHtml(input.number)}</title>
<style>
@page { size: ${paper} portrait; margin: ${paper === "A4" ? "14mm 15mm" : "10mm 11mm"}; }
* { box-sizing: border-box; }
html,body { margin: 0; padding: 0; width: 100%; background: #fff; color: #111827;
  font-family: "Noto Sans Thai","Tahoma","Segoe UI",sans-serif; font-size: ${paper === "A4" ? "12px" : "10.5px"}; line-height: 1.65; }
.page { width: 100%; max-width: 100%; }
.header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; padding-bottom: 5mm; border-bottom: 2px solid #1e4e80; }
.company { font-size: 15px; font-weight: 700; overflow-wrap: anywhere; }
.doc-title { text-align: right; color: #173e70; font-size: ${paper === "A4" ? "22px" : "18px"}; font-weight: 800; white-space: nowrap; }
.meta { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 6mm; margin: 5mm 0; }
.address { white-space: pre-wrap; overflow-wrap: anywhere; }
.muted { color: #475569; font-size: .92em; }
.box { border: 1px solid #cbd5e1; padding: 3mm; min-width: 0; }
.box-title { font-weight: 800; color: #23466c; margin-bottom: 1mm; }
table { width: 100%; border-collapse: collapse; margin-top: 5mm; table-layout: fixed; }
thead { display: table-header-group; }
th { background: #eaf0f8; color: #153957; border-top: 1px solid #b5c4d7; border-bottom: 1px solid #b5c4d7; }
th,td { padding: 2mm 1.5mm; vertical-align: top; }
tbody td { border-bottom: 1px solid #e2e8f0; }
tr { break-inside: avoid; page-break-inside: avoid; }
th:nth-child(1) { width: 7%; } th:nth-child(2) { width: 42%; }
th:nth-child(3) { width: 12%; } th:nth-child(4) { width: 18%; } th:nth-child(5) { width: 21%; }
.description { overflow-wrap: anywhere; word-break: break-word; }
.right { text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.center { text-align: center; }
.totals { width: 57%; margin: 5mm 0 0 auto; break-inside: avoid; }
.total-row { display: flex; justify-content: space-between; gap: 5mm; padding: 1.5mm 0; }
.grand { font-weight: 900; font-size: 1.25em; border-top: 2px solid #1e4e80; }
.footer { margin-top: 8mm; border-top: 1px solid #cbd5e1; padding-top: 3mm; }
@media screen { body { background: #f3f6fa; padding: 12px; } .page { background: #fff; padding: 12mm; margin: auto; max-width: ${paper === "A4" ? "210mm" : "148mm"}; box-shadow: 0 2px 12px #cbd5e1; } }
@media print { body { padding: 0; } .page { margin: 0; padding: 0; box-shadow: none; } }
</style></head><body><main class="page">
<header class="header"><div>
  <div class="company">${escapeHtml(seller.name)}</div>
  <div class="address">${escapeHtml(seller.address)}</div>
  ${seller.taxId ? `<div>เลขประจำตัวผู้เสียภาษี: ${escapeHtml(seller.taxId)}</div>` : ""}
  ${seller.phone ? `<div>โทร. ${escapeHtml(seller.phone)}</div>` : ""}
</div><div><div class="doc-title">${title}</div><div class="right muted">${english} · สำเนาเอกสาร</div></div></header>
<section class="meta">
  <div class="box"><div class="box-title">ข้อมูลผู้ซื้อ / ผู้รับบริการ</div>
    <strong>${escapeHtml(buyer.name || "ไม่ระบุ")}</strong>
    ${buyer.taxId ? `<div>เลขประจำตัวผู้เสียภาษี: ${escapeHtml(buyer.taxId)}</div>` : ""}
    ${buyer.address ? `<div class="address">${escapeHtml(buyer.address)}</div>` : ""}
  </div>
  <div class="box"><div class="box-title">ข้อมูลเอกสาร</div>
    <div>เลขที่: <strong>${escapeHtml(input.number)}</strong></div>
    <div>วันที่: ${escapeHtml(dateLabel(input.issuedAt))}</div>
    ${input.paymentMethod ? `<div>ช่องทางชำระ: ${escapeHtml(input.paymentMethod)}</div>` : ""}
  </div>
</section>
<table><thead><tr><th>ลำดับ</th><th>รายละเอียด</th><th>จำนวน</th><th>ราคาต่อหน่วย</th><th>จำนวนเงิน</th></tr></thead>
<tbody>${rows || `<tr><td colspan="5" class="center">ไม่มีรายการ</td></tr>`}</tbody></table>
<section class="totals">
  <div class="total-row"><span>รวมตามรายการ</span><span>${escapeHtml(money(subtotal, input.currency))}</span></div>
  <div class="total-row"><span>ส่วนลด</span><span>${escapeHtml(money(input.discount, input.currency))}</span></div>
  <div class="total-row"><span>ภาษีตามเอกสารต้นทาง</span><span>${escapeHtml(money(input.tax, input.currency))}</span></div>
  <div class="total-row grand"><span>ยอดรวมสุทธิ (${input.currency})</span><span>${escapeHtml(money(input.total, input.currency))}</span></div>
</section>
<footer class="footer">
  ${input.note ? `<div class="address">หมายเหตุ: ${escapeHtml(input.note)}</div>` : ""}
  <div class="muted">เอกสารสำเนาจากรายการต้นทาง ไม่ใช่การบันทึกรายการรับเงินหรือออกใบกำกับภาษีใหม่</div>
</footer>
</main></body></html>`;
}

