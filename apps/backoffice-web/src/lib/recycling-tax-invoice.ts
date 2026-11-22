/** Tax-invoice presentation uses immutable snapshots written by PostgreSQL.
 * This module cannot issue invoices or infer VAT from today's settings.
 */
export type RecyclingInvoicePaper = "58" | "80" | "a4" | "a5";

export type RecyclingInvoiceSnapshot = {
  id: string;
  invoice_no: string;
  issued_at: string;
  seller_snapshot: {
    display_name: string; address: string; tax_id: string; branch_no: string;
  };
  buyer_snapshot: {
    display_name: string; tax_id: string; branch_no: string; address_line: string;
    subdistrict: string; district: string; province: string; postal_code: string;
  };
  items_snapshot: Array<{
    name: string; sku: string; quantity: number; unit: string;
    price_per_base: number; base_minor: number;
  }>;
  tax_snapshot: {
    receipt_no: string; sale_at: string; base_minor: number; vat_minor: number;
    total_minor: number; rate_pct: number | string; mode: string;
  };
};

export function recyclingVatMinor(baseMinor: number, ratePct = 7): number {
  if (!Number.isSafeInteger(baseMinor) || baseMinor < 0 ||
      !Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) {
    throw new Error("recycling_vat_invalid_amount");
  }
  return Math.round(baseMinor * ratePct / 100);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}
function amount(minor: number): string {
  return (minor / 100).toLocaleString("th-TH", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}
function toThaiDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error("recycling_tax_date_invalid");
  return new Intl.DateTimeFormat("th-TH", {
    timeZone:"Asia/Bangkok",year:"numeric",month:"short",day:"2-digit",
    hour:"2-digit",minute:"2-digit"
  }).format(date);
}
function safeMinor(raw: unknown): number {
  const v=Number(raw);
  if(!Number.isSafeInteger(v)||v<0)throw new Error("recycling_tax_invalid_snapshot");
  return v;
}
export function renderRecyclingTaxInvoiceHtml(
  invoice: RecyclingInvoiceSnapshot, paper: RecyclingInvoicePaper
): string {
  if (!["58","80","a4","a5"].includes(paper)) throw new Error("recycling_tax_paper_invalid");
  const tx=invoice.tax_snapshot;
  const base=safeMinor(tx.base_minor);
  const vat=safeMinor(tx.vat_minor);
  const gross=safeMinor(tx.total_minor);
  const rate=Number(tx.rate_pct);
  if(!invoice.invoice_no || !invoice.seller_snapshot?.tax_id ||
     !invoice.seller_snapshot?.display_name || !invoice.seller_snapshot?.address ||
     !invoice.buyer_snapshot?.display_name || !invoice.buyer_snapshot?.address_line ||
     !invoice.buyer_snapshot?.tax_id || !/^[0-9]{5}$/.test(invoice.buyer_snapshot.branch_no) ||
     !Array.isArray(invoice.items_snapshot) ||
     !invoice.items_snapshot.length || tx.mode!=="add_to_bill" ||
     rate!==7 || base<=0 || base+vat!==gross || recyclingVatMinor(base,rate)!==vat ||
     invoice.items_snapshot.reduce((sum,item)=>sum+safeMinor(item.base_minor),0)!==base) {
    throw new Error("recycling_tax_invoice_snapshot_incomplete");
  }
  const s=invoice.seller_snapshot;
  const b=invoice.buyer_snapshot;
  const width=paper==="58"?"58mm":paper==="80"?"80mm":paper==="a4"?"210mm":"148mm";
  const thermal=paper==="58"||paper==="80";
  const pageSize=paper==="58"?"58mm auto":paper==="80"?"80mm auto":paper==="a4"?"A4 portrait":"A5 portrait";
  const padding=thermal?"3mm":"12mm";
  const fontSize=paper==="58"?"10px":paper==="80"?"12px":"13px";
  const buyerAddress=[b.address_line,b.subdistrict,b.district,b.province,b.postal_code].filter(Boolean).join(" ");
  const rows=invoice.items_snapshot.map((item,i)=>`<tr>
    <td>${i+1}</td><td><strong>${escapeHtml(item.name)}</strong><div class="muted">${escapeHtml(item.sku)}</div></td>
    <td class="right">${escapeHtml(item.quantity)} ${escapeHtml(item.unit)}</td>
    <td class="right">${escapeHtml(amount(item.base_minor))}</td>
  </tr>`).join("");
  return `<!doctype html><html lang="th"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ใบกำกับภาษี ${escapeHtml(invoice.invoice_no)}</title>
  <style>
    @page{size:${pageSize};margin:0}
    *{box-sizing:border-box}
    html,body{padding:0;margin:0;font-family:Tahoma,"Noto Sans Thai",Arial,sans-serif;color:#111827}
    body{max-width:${width};margin:0 auto;background:white;font-size:${fontSize};line-height:1.52}
    .paper{padding:${padding}}
    .center{text-align:center}.right{text-align:right}.muted{color:#64748b}
    h1{font-size:1.35em;margin:0 0 2px}.header{margin-bottom:12px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:2px 8px}
    .part{border-top:1px solid #94a3b8;padding-top:8px;margin-top:10px}
    table{width:100%;border-collapse:collapse;font-size:.94em;margin-top:8px}
    th,td{padding:5px 3px;text-align:left;vertical-align:top;border-bottom:1px solid #e2e8f0}
    th{font-weight:bold;border-bottom:1px solid #64748b}
    .sum{display:flex;justify-content:space-between;gap:10px;padding:3px 0}
    .total{font-weight:bold;font-size:1.15em;border-top:1px solid #64748b;margin-top:4px;padding-top:5px}
    .foot{font-size:.8em;margin-top:15px}
    @media screen{body{border:1px solid #e2e8f0;margin:12px auto;box-shadow:0 2px 8px #0001}}
    @media print{body{border:0;box-shadow:none;margin:0}tr{break-inside:avoid}}
    ${thermal?".meta{grid-template-columns:1fr}th,td{padding:3px 1px}.paper{overflow-wrap:anywhere}":""}
  </style></head><body><main class="paper">
    <header class="header center"><h1>ใบกำกับภาษี</h1><div>TAX INVOICE</div>
      <strong>${escapeHtml(s.display_name)}</strong></header>
    <div>ที่อยู่ผู้ขาย: ${escapeHtml(s.address)}</div>
    <div>เลขประจำตัวผู้เสียภาษี: ${escapeHtml(s.tax_id)} · สาขา ${escapeHtml(s.branch_no)}</div>
    <div class="part meta"><div><strong>เลขที่ใบกำกับภาษี</strong> ${escapeHtml(invoice.invoice_no)}</div>
      <div><strong>วันที่ออก</strong> ${escapeHtml(toThaiDate(invoice.issued_at))}</div>
      <div><strong>อ้างอิงใบขาย</strong> ${escapeHtml(tx.receipt_no)}</div>
      <div><strong>วันที่ขาย</strong> ${escapeHtml(toThaiDate(tx.sale_at))}</div></div>
    <section class="part"><strong>ผู้ซื้อ: ${escapeHtml(b.display_name)}</strong>
      <div>เลขประจำตัวผู้เสียภาษี: ${escapeHtml(b.tax_id)} · สาขา ${escapeHtml(b.branch_no)}</div>
      <div>ที่อยู่: ${escapeHtml(buyerAddress)}</div></section>
    <section class="part"><table aria-label="รายการสินค้า">
      <thead><tr><th>#</th><th>รายการ</th><th class="right">จำนวน</th><th class="right">มูลค่า (บาท)</th></tr></thead>
      <tbody>${rows}</tbody></table></section>
    <section class="part">
      <div class="sum"><span>มูลค่าสินค้าก่อน VAT</span><strong>${amount(base)}</strong></div>
      <div class="sum"><span>ภาษีมูลค่าเพิ่ม VAT 7%</span><strong>${amount(vat)}</strong></div>
      <div class="sum total"><span>รวมทั้งสิ้น (บาท)</span><strong>${amount(gross)}</strong></div>
    </section>
    <footer class="foot">เอกสารฉบับนี้ออกจากยอดขายและ VAT ที่บันทึกจริง
      ไม่คำนวณย้อนหลังจากการตั้งค่าปัจจุบัน · สำเนาเก็บในทะเบียนใบกำกับภาษีของร้านค้า</footer>
  </main></body></html>`;
}
