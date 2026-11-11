import type { PosSalesSummaryPayload } from "@/lib/services/pos-sales-summary-service";

export type SalesPrintKind = "summary" | "payments" | "products" | "cashiers" | "sales" | "sale_row" | "shift_row";
export type SalesPrintLanguage = "th" | "en" | "lo";
export type SalesPrintInput = {
  payload: PosSalesSummaryPayload;
  kind: SalesPrintKind;
  paperWidthMm: 58 | 80;
  language: SalesPrintLanguage;
  rowId?: string | null;
};

const translations = {
  th: ["รายงานสรุปยอดขาย","รายงานเพื่อการตรวจสอบ ไม่ใช่ใบเสร็จรับเงินหรือใบกำกับภาษี","สรุปยอดขาย","ช่องทางชำระเงิน","สินค้าขายดี","ประสิทธิภาพพนักงาน","รายการขาย","สรุปบิลขาย","สรุปกะ","สาขา","ช่วงวันที่","ตัวกรอง","สกุลเงิน","เลขที่บิล","พนักงาน","จำนวนบิล","ยอดขายรวม","ยอดสุทธิ","เงินสด","โอน / QR","บัตร","ส่วนลด","ภาษี","ยกเลิก","จำนวน","สินค้า","จำนวนเงิน","ชำระเงิน","วันเวลา","เปิดกะ","ปิดกะ","เงินคาดหวัง","เงินนับจริง","ส่วนต่าง","เงินต้น","สถานะ","มีบิลต่างสกุลเงิน/ไม่ทราบสกุลเงินซึ่งไม่รวมในยอดข้างต้น","เฉลี่ย/บิล"],
  en: ["Sales summary report","Management report — not a tax invoice or receipt","Sales summary","Payment methods","Best-selling products","Cashier performance","Sales transactions","Sale overview","Shift report","Branch","Period","Filters","Currency","Bill no.","Cashier","Receipts","Gross sales","Net sales","Cash","QR / Transfer","Card","Discount","Tax","Cancelled","Quantity","Product","Amount","Payment","Date/time","Opened","Closed","Expected cash","Actual cash","Variance","Opening cash","Status","Other or unknown-currency sales are excluded from these totals","Average/bill"],
  lo: ["ລາຍງານສະຫຼຸບຍອດຂາຍ","ລາຍງານບໍລິຫານ ບໍ່ແມ່ນໃບຮັບເງິນ","ຍອດຂາຍ","ຊ່ອງທາງຊຳລະ","ສິນຄ້າຂາຍດີ","ພະນັກງານ","ລາຍການຂາຍ","ສະຫຼຸບບິນ","ສະຫຼຸບກະ","ສາຂາ","ໄລຍະ","ຕົວກອງ","ສະກຸນເງິນ","ເລກບິນ","ພະນັກງານ","ບິນ","ຍອດລວມ","ຍອດສຸດທິ","ເງິນສົດ","ໂອນ / QR","ບັດ","ສ່ວນຫຼຸດ","ພາສີ","ຍົກເລີກ","ຈຳນວນ","ສິນຄ້າ","ຈຳນວນເງິນ","ຊຳລະ","ວັນເວລາ","ເປີດກະ","ປິດກະ","ເງິນຄາດຫວັງ","ເງິນຈິງ","ສ່ວນຕ່າງ","ເງິນຕົ້ນ","ສະຖານະ","ບິນສະກຸນອື່ນບໍ່ລວມໃນຍອດນີ້","ສະເລ່ຍ/ບິນ"]
} as const;
export function safeReportText(value: unknown) {
  return String(value ?? "-").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240);
}
function esc(value: unknown) {
  return safeReportText(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function fmt(value: number, currency: string) {
  const symbol = currency === "THB" ? "฿" : currency === "LAK" ? "₭" : "$";
  const digits = currency === "LAK" ? 0 : 2;
  return symbol + new Intl.NumberFormat("en-US",{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value);
}
function pair(label: string, value: unknown, strong = false) {
  return '<div class="kv'+(strong?' emph':'')+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';
}
function localTime(value: string | null, lang: SalesPrintLanguage) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(lang==="th"?"th-TH":lang==="lo"?"lo-LA":"en-GB",{timeZone:"Asia/Bangkok",dateStyle:"short",timeStyle:"short"}) : "-";
}
function paymentName(value: string, l: readonly string[]) {
  return value==="cash"?l[18]:value==="bank_transfer"?l[19]:value==="card"?l[20]:safeReportText(value);
}
const headings: Record<SalesPrintKind, number> = {summary:2,payments:3,products:4,cashiers:5,sales:6,sale_row:7,shift_row:8};

export function renderSalesPrintHtml({payload,kind,paperWidthMm,language,rowId}:SalesPrintInput) {
  const l = translations[language];
  const s = payload.summary, f = payload.filters, currency = payload.currencyCode;
  const money = (n:number) => fmt(n,currency);
  const branchName = f.branchId==="all" ? (language==="th"?"ทุกสาขา":"All branches")
    : payload.branchOptions.find(x=>x.id===f.branchId)?.name ?? "-";
  const selectedFilters = [
    f.shiftId!=="all" ? "Shift: "+f.shiftId : "",
    f.cashierId!=="all" ? l[14]+": "+(payload.cashierOptions.find(x=>x.id===f.cashierId)?.label ?? "-") : "",
    f.paymentMethod!=="all" ? l[27]+": "+paymentName(f.paymentMethod,l) : "",
    f.status!=="all" ? l[35]+": "+f.status : ""
  ].filter(Boolean).join(" · ");
  let body="";
  if(kind==="summary") {
    body=pair(l[16],money(s.grossSales))+pair(l[17],money(s.netSales),true)+pair(l[15],s.receiptCount)
      +pair(l[18],money(s.cashTotal))+pair(l[19],money(s.qrTransferTotal))+pair(l[20],money(s.cardTotal))
      +pair(l[21],money(s.discountTotal))+pair(l[22],money(s.taxTotal))
      +pair(l[23],money(s.cancelledTotal)+" ("+s.cancelledCount+")");
  } else if(kind==="payments") {
    body=payload.paymentMethods.map(p=>pair(paymentName(p.method,l)+" ("+p.receiptCount+")",money(p.amount))).join("")
      +pair(l[17],money(s.netSales),true);
  } else if(kind==="products") {
    body=payload.bestSellingProducts.map((p,i)=>'<div class="item"><b>'+esc((i+1)+". "+p.productName)+'</b><small>'
      +esc(p.category+" · "+l[24]+" "+p.quantitySold)+'</small>'+pair(l[17],money(p.netAmount))+'</div>').join("");
  } else if(kind==="cashiers") {
    body=payload.cashiers.map(p=>'<div class="item"><b>'+esc(p.cashierName)+'</b>'
      +pair(l[15],p.receiptCount)+pair(l[16],money(p.grossSales))+pair(l[17],money(p.netSales))
      +pair(l[23],p.cancelledCount)+pair(l[37],money(p.averageReceiptValue))+'</div>').join("");
  } else if(kind==="sales") {
    if(payload.salesRows.length>120) throw new Error("sales_print_too_many_rows_narrow_period");
    body=payload.salesRows.map(p=>'<div class="item"><b>'+esc(p.receiptNo)+'</b><small>'
      +esc(localTime(p.createdAt,language))+'</small>'+pair(l[14],p.cashierName)
      +pair(l[27],paymentName(p.paymentMethod,l))+pair(l[17],money(p.netTotal),true)
      +pair(l[35],p.status)+'</div>').join("");
    body+=pair(l[15],payload.salesRows.length)+pair(l[17],money(s.netSales),true);
  } else if(kind==="sale_row") {
    const r=payload.salesRows.find(p=>p.id===rowId);
    if(!r) throw new Error("sales_print_row_not_in_authorized_scope");
    body=pair(l[13],r.receiptNo)+pair(l[28],localTime(r.createdAt,language))
      +pair(l[9],r.branchName)+pair(l[14],r.cashierName)+pair(l[27],paymentName(r.paymentMethod,l))
      +pair(l[16],money(r.grossTotal))+pair(l[21],money(r.discount))+pair(l[22],money(r.tax))
      +pair(l[17],money(r.netTotal),true)+pair(l[35],r.status);
  } else if(kind==="shift_row") {
    const r=payload.shifts.find(p=>p.id===rowId);
    if(!r) throw new Error("sales_print_row_not_in_authorized_scope");
    body=pair(l[9],r.branchName)+pair(l[14],r.cashierName)+pair(l[29],localTime(r.openedAt,language))
      +pair(l[30],localTime(r.closedAt,language))+pair(l[15],r.receiptCount)
      +pair(l[17],money(r.netSales),true)+pair(l[34],money(r.openingCash))+pair(l[18],money(r.cashSales))
      +pair(l[31],money(r.expectedCash))+pair(l[32],r.actualCash===null?"-":money(r.actualCash))
      +pair(l[33],r.difference===null?"-":money(r.difference));
  }
  if(!body) body='<div class="empty">-</div>';
  const otherCurrencies=payload.currencyBuckets.filter(b=>b.currencyCode!==currency);
  const note=otherCurrencies.length?'<p class="note">'+esc(l[36])+'<br/>'
    +otherCurrencies.map(b=>esc(b.currencyCode+" ("+b.receiptCount+" bills)")).join("<br/>")+'</p>':"";
  const printableMm=paperWidthMm===80?56:42;
  const html='<!doctype html><html lang="'+language+'"><head><meta charset="utf-8"/><title>'+esc(l[headings[kind]])+'</title>'
    +'<style>@page{size:'+paperWidthMm+'mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;width:'+paperWidthMm
    +'mm;background:#fff;color:#000;font-family:"Noto Sans Thai","Noto Sans Lao",Tahoma,sans-serif}'
    +'main.receipt{width:'+printableMm+'mm;margin:0 0 0 1mm;padding:1.5mm 0 3mm;font-size:11px;line-height:1.35;overflow-wrap:anywhere}'
    +'h1{font-size:15px;text-align:center;margin:1mm 0;font-weight:900}h2{font-size:12px;text-align:center;margin:2mm 0}'
    +'p.meta{margin:1mm 0;font-size:10px}.kv{display:flex;align-items:flex-start;justify-content:space-between;gap:2mm;padding:1.1mm 0;border-bottom:1px dotted #aaa}'
    +'.kv span{max-width:52%;flex:1 1 auto;overflow-wrap:anywhere}.kv strong{text-align:right;max-width:55%;overflow-wrap:anywhere;font-weight:700}'
    +'.kv.emph{border-top:1px solid #111;font-size:13px;font-weight:900}.item{border-bottom:1px dashed #999;padding:1.6mm 0;break-inside:avoid}'
    +'.item b,.item small{display:block;overflow-wrap:anywhere}.item small{font-size:9px}.note,.disclaimer{font-size:9px;margin-top:2mm;text-align:center}'
    +'</style></head><body><main class="receipt"><h1>CpiPOS</h1><h2>'+esc(l[0])+'</h2>'
    +'<p class="meta">'+esc(l[9])+': '+esc(branchName)+'</p><p class="meta">'+esc(l[10])+': '+esc(f.dateFrom)+' — '+esc(f.dateTo)+'</p>'
    +'<p class="meta">'+esc(l[12])+': '+esc(currency)+'</p>'
    +(selectedFilters?'<p class="meta">'+esc(l[11]+": "+selectedFilters)+'</p>':"")
    +'<hr/><h2>'+esc(l[headings[kind]])+'</h2>'+body+note
    +'<p class="disclaimer">'+esc(l[1])+'</p></main></body></html>';
  if(html.length>200_000) throw new Error("sales_print_document_too_large");
  return {html,title:l[headings[kind]],paperWidthMm};
}
