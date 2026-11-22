import type { AuthContext } from "@/lib/auth-context";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { resolvePrinterRoutes } from "@/lib/printing/printer-routing-service";
import { renderRecyclingSharedReceipt } from "@/lib/printing/recycling-receipt-print-service";
import { loadReceiptStoreProfile } from "@/lib/services/store-profile-service";
import { loadTaxSettings } from "@/lib/services/pos-settings-service";
import { recyclingReceiptTaxNotice } from "@/lib/printing/recycling-tax-receipt-note";

export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const headers={
  "Cache-Control":"private, no-store, max-age=0",
  "X-Content-Type-Options":"nosniff",
  "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
};
function fail(status:number,message:string){
  return new Response(message,{status,headers:{"Content-Type":"text/plain; charset=utf-8",...headers}});
}

/** Same immutable receipt used for automatic POS printing.
 *  Read-only HTML preview for the in-app modal and A5 browser printing.
 *  Does not send jobs, create invoices, edit stock or accept arbitrary HTML.
 */
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;
    if(!UUID.test(id))return fail(422,"เลขเอกสารไม่ถูกต้อง");
    const scope=await requirePosSession();
    requirePermission(scope,"shift:join");
    if(!["owner","manager","staff","accountant"].includes(scope.session.role) ||
       !await isAuthorizedRecyclingTenant(scope.session.tenant_id))return fail(403,"ไม่มีสิทธิ์ดูใบรับซื้อ");
    if(process.env.RECYCLING_STOCK_SCHEMA_READY!=="1")return fail(503,"ระบบใบรับซื้อยังไม่พร้อม");
    const query=new URL(request.url).searchParams;
    const paper=query.get("paper")??"auto";
    if(!["auto","58","80","a5"].includes(paper))return fail(422,"ขนาดกระดาษไม่ถูกต้อง");
    const db=getSupabaseServiceClient();
    const {tenant_id:tenantId,branch_id:branchId,device_code:deviceCode,role}=scope.session;
    const auth:AuthContext={tenantId,branchId,userId:scope.session.user_id,
      platformRole:"tenant_user",
      branchRole:role==="owner"||role==="manager"||role==="accountant"?role:"staff"};
    const [tx,lines,tenant,branch,profile,taxSettings]=await Promise.all([
      db.from("recycling_transactions")
        .select("id,receipt_no,direction,settlement,counterparty_name,total_minor,status,void_reason,created_at")
        .eq("id",id).eq("tenant_id",tenantId).eq("branch_id",branchId).maybeSingle(),
      db.from("recycling_transaction_lines")
        .select("line_no,sku_snapshot,name_snapshot,original_quantity,original_unit,base_unit,price_per_base,amount_minor")
        .eq("transaction_id",id).eq("tenant_id",tenantId).eq("branch_id",branchId)
        .order("line_no"),
      db.from("tenants").select("name,display_name").eq("id",tenantId).maybeSingle(),
      db.from("branches").select("name").eq("id",branchId).eq("tenant_id",tenantId).maybeSingle(),
      loadReceiptStoreProfile(tenantId),
      loadTaxSettings(auth).catch(()=>null)
    ]);
    if(tx.error||lines.error||tenant.error||branch.error||!tx.data||
       !["posted","voided"].includes(tx.data.status)||!lines.data?.length)return fail(404,"ไม่พบใบรับซื้อหรือขายออก");
    const storedTotal=Number(tx.data.total_minor);
    if(!Number.isSafeInteger(storedTotal)||storedTotal<0||
       lines.data.some(l=>!Number.isSafeInteger(Number(l.amount_minor))||Number(l.amount_minor)<0)||
       lines.data.reduce((sum,l)=>sum+Number(l.amount_minor),0)!==storedTotal){
      return fail(409,"ยอดเอกสารและรายละเอียดวัสดุไม่ตรงกัน กรุณาติดต่อฝ่าย IT");
    }
    let width:58|80=80;
    if(paper==="58")width=58;
    else if(paper==="auto"){
      // Missing printer setup should not prevent on-screen proof or A5 printing.
      try{
        const routes=await resolvePrinterRoutes({auth,purpose:"receipt",
          fallbackPurposes:["reprint"],runtimeDeviceCode:deviceCode,legacyRole:"receipt"});
        if(routes[0]?.printer.paper_width_mm===58)width=58;
      }catch{ /* preview remains available even without a local printer */ }
    }
    const html=renderRecyclingSharedReceipt({
      width,shop:tenant.data?.display_name||tenant.data?.name||
        profile?.display_name||profile?.name||"ร้านค้าวัสดุรีไซเคิล",
      branch:branch.data?.name||"สาขา",receiptNo:tx.data.receipt_no,
      direction:tx.data.direction,status:tx.data.status,voidReason:tx.data.void_reason,
      createdAt:tx.data.created_at,counterparty:tx.data.counterparty_name||"-",
      settlement:tx.data.settlement,totalMinor:storedTotal,lines:lines.data,
      storeAddress:profile?.company_address??null,storePhone:profile?.contact_phone??null,
      logoUrl:profile?.logo_url??null,
      taxNotice:recyclingReceiptTaxNotice(taxSettings)
    });
    // A5 uses the same stored receipt data and item rows, while the browser
    // printer driver selects an A4/A5-capable device. Never force silent USB
    // printing from Vercel or mislabel this document as a tax invoice.
    const a5Css=`<style id="recycling-a5-paper">
      @page { size: A5 portrait; margin: 10mm; }
      html,body { width: auto !important; min-width:0; margin:0; background:white; }
      .receipt { margin:0 !important; padding:0 !important; width:100% !important; max-width:none !important;
        font-size:13px !important; line-height:1.45; }
      .head-title {font-size:17px !important;}
      .logo-wrap img {max-width:35mm;max-height:22mm;}
      .col-qty {width:27mm !important;} .col-total {width:35mm !important;}
      .foot {margin-top:5mm;}
      @media screen {body{max-width:160mm;padding:8mm;margin:auto;box-shadow:0 0 0 1px #e2e8f0;}}
      @media print {table tr, .summary-line {break-inside:avoid;}}
    </style>`;
    return new Response(paper==="a5"?html.replace("</head>",a5Css+"</head>"):html,{
      status:200,headers:{"Content-Type":"text/html; charset=utf-8",...headers}
    });
  }catch(error){
    if(error instanceof PosGuardError)return fail(error.status,error.message);
    return fail(503,"ไม่สามารถโหลดใบรับซื้อได้ กรุณาตรวจสอบการเชื่อมต่อ");
  }
}
