import "server-only";

import type { AuthContext } from "@/lib/auth-context";
import { readEnv } from "@/lib/env";
import { enqueuePrintJob, processPrintJob } from "@/lib/printing/print-service";
import { resolvePrinterRoutes } from "@/lib/printing/printer-routing-service";
import { loadReceiptStoreProfile } from "@/lib/services/store-profile-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type MaterialLine = {
  line_no: number;
  sku_snapshot: string;
  name_snapshot: string;
  original_quantity: number;
  original_unit: string;
  base_unit: string;
  price_per_base: number;
  amount_minor: number;
};

const escapeHtml = (v: unknown) => String(v ?? "").replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const thaiMoney = (minor: number) => (minor / 100).toLocaleString("th-TH", {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});
const unitNames: Record<string,string> = { kg:"กก.",khid:"ขีด",g:"กรัม",ton:"ตัน",stem:"ต้น",piece:"ชิ้น" };

function renderRecyclingThermalReceipt(args: {
  width: 58 | 80;
  shop: string;
  branch: string;
  receiptNo: string;
  direction: string;
  date: string;
  counterparty: string;
  settlement: string;
  totalMinor: number;
  lines: MaterialLine[];
}) {
  const label = args.direction === "buy" ? "หลักฐานรับซื้อวัสดุรีไซเคิล" : "หลักฐานขายออกวัสดุรีไซเคิล";
  const settle = { cash:"เงินสด",bank_transfer:"เงินโอน",credit:"เครดิต/ค้างชำระ" }[args.settlement] ?? args.settlement;
  const items = args.lines.map(l => `<tr>
    <td class="item"><strong>${escapeHtml(l.name_snapshot)}</strong>
      <span>${escapeHtml(l.sku_snapshot)}</span>
      <span>${escapeHtml(l.original_quantity)} ${escapeHtml(unitNames[l.original_unit] ?? l.original_unit)}
       × ${escapeHtml(Number(l.price_per_base).toFixed(2))}/${l.base_unit==="kg"?"กก.":"ชิ้น"}</span></td>
    <td class="value">${escapeHtml(thaiMoney(Number(l.amount_minor)))}</td>
  </tr>`).join("");
  const margin = args.width === 58 ? 2 : 3;
  const contentWidth = args.width === 58 ? 45 : 56;
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"/>
  <style>
    @page {size:${args.width}mm auto; margin:${margin}mm;}
    html,body{font-family:Tahoma,Arial,sans-serif!important;color:#000;background:#fff;
      font-size:12px;line-height:1.45;margin:0;padding:0;}
    .ticket{max-width:${contentWidth}mm;margin:0 auto;overflow-wrap:anywhere;box-sizing:border-box;}
    .head{text-align:center;border-bottom:1px dashed #777;padding-bottom:7px;}
    .head strong{display:block;font-size:15px;}
    .head h1{font-size:12.5px;line-height:1.3;margin:7px 0 2px;}
    .meta{padding:7px 0;border-bottom:1px dashed #888;}
    .meta div{margin-bottom:3px;}
    table{width:100%;border-collapse:collapse;table-layout:fixed;}
    .item{width:66%;padding:6px 4px 6px 0;vertical-align:top;}
    .item span{display:block;font-size:10px;}
    .value{width:34%;text-align:right;vertical-align:top;padding:6px 0;font-weight:700;}
    td{border-bottom:1px dashed #ddd;}
    .total{border-top:1px solid #222;padding:10px 0;font-weight:700;
      font-size:15px;display:flex;justify-content:space-between;}
    .foot{text-align:center;border-top:1px dashed #999;padding-top:7px;font-size:10px;}
  </style></head><body><article class="ticket">
    <header class="head"><strong>${escapeHtml(args.shop)}</strong>
      <div>${escapeHtml(args.branch)}</div>
      <h1>${label}</h1><div>เอกสารซื้อขายทั่วไป ไม่ใช่ใบกำกับภาษี</div></header>
    <section class="meta"><div>เลขที่ ${escapeHtml(args.receiptNo)}</div>
      <div>วันที่ ${escapeHtml(args.date)}</div>
      <div>${args.direction==="buy"?"ผู้ขายวัสดุ":"ผู้ซื้อวัสดุ"}: ${escapeHtml(args.counterparty)}</div>
      <div>ชำระ: ${escapeHtml(settle)}</div></section>
    <table><tbody>${items}</tbody></table>
    <div class="total"><span>รวมทั้งสิ้น</span><span>${escapeHtml(thaiMoney(args.totalMinor))} บาท</span></div>
    <footer class="foot">สำเนา/พิมพ์ย้อนหลัง • CpiPOS CUSTOM Recycling
      <div>น้ำหนักตามการชั่งภายนอก</div></footer>
  </article></body></html>`;
}

export async function queueRoutedRecyclingReceipt(args: {
  auth: AuthContext;
  runtimeDeviceCode?: string | null;
  transactionId: string;
  requestId: string;
}) {
  if (!args.auth.tenantId || !args.auth.branchId) throw new Error("recycling_printer_scope_required");
  const db = getSupabaseServiceClient();
  const [tx, lines, tenant, branch] = await Promise.all([
    db.from("recycling_transactions")
      .select("id,receipt_no,direction,settlement,counterparty_name,total_minor,status,created_at")
      .eq("id",args.transactionId).eq("tenant_id",args.auth.tenantId).eq("branch_id",args.auth.branchId).maybeSingle(),
    db.from("recycling_transaction_lines")
      .select("line_no,sku_snapshot,name_snapshot,original_quantity,original_unit,base_unit,price_per_base,amount_minor")
      .eq("transaction_id",args.transactionId).eq("tenant_id",args.auth.tenantId)
      .eq("branch_id",args.auth.branchId).order("line_no"),
    db.from("tenants").select("name,display_name").eq("id",args.auth.tenantId).maybeSingle(),
    db.from("branches").select("name").eq("id",args.auth.branchId)
      .eq("tenant_id",args.auth.tenantId).maybeSingle()
  ]);
  if (tx.error || !tx.data || tx.data.status!=="posted") throw new Error("recycling_receipt_not_found");
  if (lines.error || !lines.data?.length) throw new Error("recycling_receipt_lines_missing");
  const totalLines = lines.data.reduce((total,line)=>total+Number(line.amount_minor),0);
  if (totalLines!==Number(tx.data.total_minor)) throw new Error("recycling_receipt_total_mismatch");
  if (tenant.error || branch.error) throw new Error("recycling_receipt_shop_unavailable");

  const storeProfile = await loadReceiptStoreProfile(args.auth.tenantId);
  const shop = tenant.data?.display_name || tenant.data?.name ||
    storeProfile?.display_name || storeProfile?.name || "ร้านวัสดุรีไซเคิล";
  const branchName = branch.data?.name ?? "สาขา";
  const date = new Intl.DateTimeFormat("th-TH",{
    timeZone:"Asia/Bangkok",dateStyle:"medium",timeStyle:"short"
  }).format(new Date(tx.data.created_at));
  const routes = await resolvePrinterRoutes({
    auth:args.auth,purpose:"receipt",fallbackPurposes:["reprint"],
    runtimeDeviceCode:args.runtimeDeviceCode,legacyRole:"receipt"
  });
  if (!routes.length) throw new Error("recycling_receipt_printer_not_configured");
  const jobs = [];
  for (const route of routes) {
    for (let copy=1;copy<=route.copies;copy+=1) {
      const html=renderRecyclingThermalReceipt({
        width:route.printer.paper_width_mm,shop,branch:branchName,
        receiptNo:tx.data.receipt_no,direction:tx.data.direction,
        date,counterparty:tx.data.counterparty_name,settlement:tx.data.settlement,
        totalMinor:Number(tx.data.total_minor),lines:lines.data as MaterialLine[]
      });
      const textReceipt = [shop,branchName,tx.data.receipt_no,date,
        tx.data.direction==="buy"?"รับซื้อวัสดุรีไซเคิล":"ขายออกวัสดุรีไซเคิล",
        ...lines.data.map(l=>`${l.name_snapshot} ${l.original_quantity} ${unitNames[l.original_unit]??l.original_unit} ${thaiMoney(Number(l.amount_minor))}`),
        `รวม ${thaiMoney(Number(tx.data.total_minor))} บาท`,
        "เอกสารซื้อขายทั่วไป ไม่ใช่ใบกำกับภาษี"].join("\n");
      const requestKey=`rcy:${args.transactionId}:${args.requestId}:${route.printer.id}:${copy}`.slice(0,180);
      const job=await enqueuePrintJob({
        auth:args.auth,printer:route.printer,orderId:null,
        printerRole:"receipt",idempotencyKey:requestKey,
        payloadText:textReceipt,
        payloadJson:{
          recycling_transaction_id:args.transactionId,
          receipt_no:tx.data.receipt_no,
          direction:tx.data.direction,
          branch_name:branchName,
          total_minor:Number(tx.data.total_minor),
          settlement:tx.data.settlement
        },
        metadata:{
          request_source:"recycling_receipt_reprint",
          routing_source:route.source,
          routing_purpose:route.purpose,
          routing_printer_device_id:route.printerDeviceId,
          copy_number:copy,copy_count:route.copies,
          paper_width_mm:route.printer.paper_width_mm,
          payload_format:"receipt_html_v1",
          payload_html:html
        }
      });
      const serverDirect=(route.printer.metadata &&
        typeof route.printer.metadata==="object"&&!Array.isArray(route.printer.metadata))
        ? route.printer.metadata as Record<string,unknown> : {};
      // Do not try to address the customer's local USB printer from the
      // Vercel cloud runtime. The assigned browser/Windows print agent owns it.
      const shouldQueue=readEnv("VERCEL")==="1" || Boolean(readEnv("VERCEL_ENV")) ||
        serverDirect.print_mode==="agent" || serverDirect.queue_only===true;
      jobs.push(shouldQueue?job:(await processPrintJob(job.id))??job);
    }
  }
  return jobs.map(job=>({
    id:job.id,status:job.status,printer_id:job.printer_id,
    printed_at:job.printed_at,last_error:job.last_error
  }));
}
