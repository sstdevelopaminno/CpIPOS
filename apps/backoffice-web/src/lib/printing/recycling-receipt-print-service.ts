import "server-only";

import type { AuthContext } from "@/lib/auth-context";
import { readEnv } from "@/lib/env";
import { enqueuePrintJob, processPrintJob } from "@/lib/printing/print-service";
import { resolvePrinterRoutes } from "@/lib/printing/printer-routing-service";
import { loadReceiptStoreProfile } from "@/lib/services/store-profile-service";
import { renderReceiptHtml } from "@/lib/printing/receipt-html-template";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { loadTaxSettings } from "@/lib/services/pos-settings-service";
import { recyclingReceiptTaxNotice } from "@/lib/printing/recycling-tax-receipt-note";

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

const thaiMoney = (minor: number) => (minor / 100).toLocaleString("th-TH", {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});
const unitNames: Record<string,string> = { kg:"กก.",khid:"ขีด",g:"กรัม",ton:"ตัน",stem:"ต้น",piece:"ชิ้น" };

/** The same 58/80mm thermal template as every standard CpiPOS checkout.
 * Only labels, weight units, settlement direction and VOID language differ. */
export function renderRecyclingSharedReceipt(args: {
  width: 58 | 80;
  shop: string;
  branch: string;
  receiptNo: string;
  direction: string;
  status: string;
  voidReason?: string | null;
  createdAt: string;
  counterparty: string;
  settlement: string;
  totalMinor: number;
  baseMinor?: number | null;
  vatMinor?: number | null;
  taxState?: string | null;
  lines: MaterialLine[];
  storeAddress?: string | null;
  storePhone?: string | null;
  logoUrl?: string | null;
  taxNotice?: string;
  centerOnPaper?: boolean;
  thermalOffsetMm?: number;
}) {
  const isBuy = args.direction === "buy";
  const isCredit = args.settlement === "credit";
  const heading = isBuy ? "รับซื้อวัสดุรีไซเคิล" : "ขายออกวัสดุรีไซเคิล";
  const isTaxRecorded=!isBuy&&args.taxState==="vat_recorded";
  const base=Number(args.baseMinor ?? args.totalMinor);
  const vat=isTaxRecorded?Number(args.vatMinor ?? 0):0;
  if(!Number.isSafeInteger(base)||base<0||!Number.isSafeInteger(vat)||vat<0||
    base+vat!==args.totalMinor||
    args.lines.reduce((sum,line)=>sum+Number(line.amount_minor),0)!==base){
    throw new Error("recycling_receipt_total_mismatch");
  }
  // Only settled cash or verified transfers receive "ใบเสร็จ". Historical
  // credit documents remain evidence of outstanding payable/receivable.
  const documentTitle = isCredit
    ? (isBuy ? "หลักฐานรับซื้อวัสดุรีไซเคิล" : "หลักฐานขายออกวัสดุรีไซเคิล")
    : (isBuy ? "ใบเสร็จรับซื้อวัสดุรีไซเคิล" : "ใบเสร็จขายออกวัสดุรีไซเคิล");
  return renderReceiptHtml({
    paperWidthMm:args.width,
    compactRecycling:true,
    centerThermalContent:args.centerOnPaper===true,
    thermalOffsetMm:args.thermalOffsetMm,
    currencyCode:"THB",
    languageCode:"th",
    storeName:args.shop,
    branchName:args.branch,
    storeAddress:args.storeAddress,
    storePhone:args.storePhone,
    logoUrl:args.logoUrl,
    sellerName:args.counterparty,
    sellerLabel:isBuy ? "ผู้ขายวัสดุ" : "ผู้ซื้อวัสดุ",
    orderNo:args.receiptNo,
    modeLabel:isBuy ? "รับซื้อเข้าร้าน" : "ขายออก",
    documentHeading:documentTitle,
    paidAtIso:args.createdAt,
    items:args.lines.map(line=>({
      name:line.name_snapshot,
      sku:line.sku_snapshot,
      quantity:Number(line.original_quantity),
      quantityDisplay:`${line.original_quantity} ${unitNames[line.original_unit] ?? line.original_unit}`,
      unitPrice:Number(line.price_per_base),
      unitPriceSuffix:`/${line.base_unit === "kg" ? "กก." : "ชิ้น"}`,
      lineTotal:Number(line.amount_minor) / 100
    })),
    discountAmount:0,
    taxAmount:vat/100,
    totalAmount:Number(args.totalMinor) / 100,
    paymentMethod:args.settlement,
    // A Recycling purchase is a cash payout, not cash received/change.
    hideCashTenderBreakdown:isBuy,
    documentNotice:isTaxRecorded
      ? "VAT 7% บันทึกจากบิลเดิม · เอกสารนี้เป็นใบเสร็จ ไม่ใช่ใบกำกับภาษี"
      : args.taxNotice??"เอกสารซื้อขายทั่วไป ไม่ใช่ใบกำกับภาษี",
    voidWarning:args.status === "voided"
      ? `เอกสารยกเลิก VOID — ไม่ใช้ยืนยันธุรกรรมที่ยังมีผล (${args.voidReason ?? "ยกเลิก"})` : null,
    // Credit records document the receivable/payable, not an actual cash movement.
    paymentHeading:isCredit
      ? (isBuy ? "ยอดค้างจ่ายผู้ขาย" : "ยอดค้างรับจากผู้ซื้อ")
      : (isBuy ? "จ่ายเงิน" : "รับชำระเงิน"),
    footerText:isCredit
      ? `${heading} · เครดิต/ค้างชำระ — ยังไม่มีการรับหรือจ่ายเงินจริง · CpiPOS · น้ำหนักตามเครื่องชั่งภายนอก`
      : `${heading} · CpiPOS · น้ำหนักตามเครื่องชั่งภายนอก`
  });
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
      .select("id,receipt_no,direction,settlement,counterparty_name,total_minor,base_minor,vat_minor,tax_state,status,void_reason,created_at")
      .eq("id",args.transactionId).eq("tenant_id",args.auth.tenantId).eq("branch_id",args.auth.branchId).maybeSingle(),
    db.from("recycling_transaction_lines")
      .select("line_no,sku_snapshot,name_snapshot,original_quantity,original_unit,base_unit,price_per_base,amount_minor")
      .eq("transaction_id",args.transactionId).eq("tenant_id",args.auth.tenantId)
      .eq("branch_id",args.auth.branchId).order("line_no"),
    db.from("tenants").select("name,display_name").eq("id",args.auth.tenantId).maybeSingle(),
    db.from("branches").select("name").eq("id",args.auth.branchId)
      .eq("tenant_id",args.auth.tenantId).maybeSingle()
  ]);
  if (tx.error || !tx.data || !["posted","voided"].includes(tx.data.status)) throw new Error("recycling_receipt_not_found");
  if (lines.error || !lines.data?.length) throw new Error("recycling_receipt_lines_missing");
  const totalLines = lines.data.reduce((total,line)=>total+Number(line.amount_minor),0);
  const base=Number(tx.data.base_minor??tx.data.total_minor);
  const vat=Number(tx.data.vat_minor??0);
  if (totalLines!==base||base+vat!==Number(tx.data.total_minor)||
      (tx.data.tax_state!=="vat_recorded" && vat!==0) ||
      (tx.data.direction==="buy"&&vat!==0)) throw new Error("recycling_receipt_total_mismatch");
  if (tenant.error || branch.error) throw new Error("recycling_receipt_shop_unavailable");

  const [storeProfile,taxSettings]=await Promise.all([
    loadReceiptStoreProfile(args.auth.tenantId),
    loadTaxSettings(args.auth).catch(()=>null)
  ]);
  const taxNotice=tx.data.tax_state==="vat_recorded"
    ?"บันทึกภาษีขาย VAT 7% ตามยอดในบิล · ไม่ใช่ใบกำกับภาษี"
    :recyclingReceiptTaxNotice(taxSettings);
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
  // Accelerated Windows polling is explicit per printer profile, not enabled
  // for Android, other Windows stores, or unassigned branch/device routes.
  const fastWindowsWake = routes.some(route => {
    const meta = route.printer.metadata && typeof route.printer.metadata === "object" &&
      !Array.isArray(route.printer.metadata)
      ? route.printer.metadata as Record<string,unknown> : {};
    return meta.target_runtime === "windows_native" &&
      meta.windows_receipt_fast_wake === true &&
      meta.windows_device_code === args.runtimeDeviceCode;
  });
  const jobs = [];
  for (const route of routes) {
    for (let copy=1;copy<=route.copies;copy+=1) {
      const printerMetadata=route.printer.metadata && typeof route.printer.metadata==="object" &&
        !Array.isArray(route.printer.metadata) ? route.printer.metadata as Record<string,unknown> : {};
      const centerOnPaper=printerMetadata.target_runtime==="windows_native" &&
        printerMetadata.windows_receipt_centered===true &&
        printerMetadata.windows_device_code===args.runtimeDeviceCode;
      const rawOffset=Number(printerMetadata.windows_receipt_offset_mm);
      const thermalOffsetMm=centerOnPaper && Number.isFinite(rawOffset) ?
        Math.max(-6,Math.min(6,rawOffset)):0;
      const html=renderRecyclingSharedReceipt({
        width:route.printer.paper_width_mm,shop,branch:branchName,
        centerOnPaper,thermalOffsetMm,
        receiptNo:tx.data.receipt_no,direction:tx.data.direction,
        status:tx.data.status,voidReason:tx.data.void_reason,
        createdAt:tx.data.created_at,
        counterparty:tx.data.counterparty_name,settlement:tx.data.settlement,
        totalMinor:Number(tx.data.total_minor),
        baseMinor:base,vatMinor:vat,taxState:tx.data.tax_state,
        lines:lines.data as MaterialLine[],
        storeAddress:storeProfile?.company_address??null,
        storePhone:storeProfile?.contact_phone??null,
        logoUrl:storeProfile?.logo_url??null,
        taxNotice
      });
      const textReceipt = [shop,branchName,tx.data.receipt_no,date,
        ...(tx.data.status==="voided"
          ? ["ยกเลิก VOID — ห้ามใช้ยืนยันธุรกรรมที่ยังมีผล",tx.data.void_reason??""] : []),
        tx.data.direction==="buy"?"รับซื้อวัสดุรีไซเคิล":"ขายออกวัสดุรีไซเคิล",
        tx.data.settlement==="credit"
          ? "เครดิต/ค้างชำระ — ยังไม่มีการรับหรือจ่ายเงินจริง"
          : tx.data.settlement==="cash" ? "วิธีชำระเงิน: เงินสด" : "วิธีชำระเงิน: โอนเงิน (ตรวจสอบหลักฐาน)",
        ...lines.data.map(l=>`${l.name_snapshot} ${l.original_quantity} ${unitNames[l.original_unit]??l.original_unit} ${thaiMoney(Number(l.amount_minor))}`),
        ...(tx.data.tax_state==="vat_recorded"?[
          `ยอดก่อน VAT ${thaiMoney(base)} บาท`,
          `VAT 7% ${thaiMoney(vat)} บาท`
        ]:[]),
        `รวม ${thaiMoney(Number(tx.data.total_minor))} บาท`,
        taxNotice].join("\n");
      const requestKey=`rcy:${args.transactionId}:${args.requestId}:${route.printer.id}:${copy}`.slice(0,180);
      const existingJob=async () => {
        const result=await db.from("print_jobs")
          .select("id,status,printer_id,printed_at,last_error")
          .eq("tenant_id",args.auth.tenantId!)
          .eq("branch_id",args.auth.branchId!)
          .eq("idempotency_key",requestKey)
          .maybeSingle();
        if (result.error) throw new Error("recycling_receipt_print_lookup_failed");
        return result.data;
      };
      const existing=await existingJob();
      if (existing) {
        jobs.push(existing);
        continue;
      }
      let job;
      try {
        job=await enqueuePrintJob({
        auth:args.auth,printer:route.printer,orderId:null,
        printerRole:"receipt",idempotencyKey:requestKey,
        payloadText:textReceipt,
        payloadJson:{
          recycling_transaction_id:args.transactionId,
          receipt_no:tx.data.receipt_no,
          direction:tx.data.direction,
          branch_name:branchName,
          total_minor:Number(tx.data.total_minor),
          base_minor:base,vat_minor:vat,tax_state:tx.data.tax_state,
          settlement:tx.data.settlement,
          status:tx.data.status,
          void_reason:tx.data.void_reason
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
      } catch (error) {
        // A concurrent retry may have inserted the same request before ours.
        // The request key is unique, so return the existing queued job rather
        // than printing or queuing another copy.
        const message=error instanceof Error?error.message.toLowerCase():"";
        if (!message.includes("duplicate key") && !message.includes("unique constraint")) throw error;
        const raced=await existingJob();
        if (!raced) throw error;
        jobs.push(raced);
        continue;
      }
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
    printed_at:job.printed_at,last_error:job.last_error,
    fast_wake:fastWindowsWake
  }));
}
