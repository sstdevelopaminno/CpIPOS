import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { requirePosSession } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import {
  renderRecyclingTaxInvoiceHtml,
  type RecyclingInvoicePaper,
  type RecyclingInvoiceSnapshot
} from "@/lib/recycling-tax-invoice";

export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers={
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":"private, no-store, max-age=0",
  "X-Content-Type-Options":"nosniff",
  "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
};
function reject(status:number,reason:string){
  return new Response(reason,{status,headers:{"Content-Type":"text/plain; charset=utf-8",
    "Cache-Control":"private, no-store", "X-Content-Type-Options":"nosniff"}});
}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try{
    const {id}=await params;
    const paper=new URL(request.url).searchParams.get("paper")??"a4";
    if(!UUID.test(id)||!["58","80","a4","a5"].includes(paper))
      return reject(422,"Invalid invoice or paper size");
    const auth=await getPosApiAuthContext({requireBranchScope:true,requiredPermission:"receipts:view"});
    const scope=await requirePosSession();
    if(!auth.tenantId||!auth.branchId||auth.tenantId!==scope.session.tenant_id||
      auth.branchId!==scope.session.branch_id||
      !await isAuthorizedRecyclingTenant(auth.tenantId))return reject(403,"Forbidden");
    const {data,error}=await getSupabaseServiceClient().from("recycling_tax_invoices")
      .select("id,invoice_no,issued_at,seller_snapshot,buyer_snapshot,items_snapshot,tax_snapshot")
      .eq("id",id).eq("tenant_id",auth.tenantId).eq("branch_id",auth.branchId)
      .eq("status","issued").maybeSingle();
    if(error||!data)return reject(404,"ไม่พบใบกำกับภาษีในสาขานี้");
    const html=renderRecyclingTaxInvoiceHtml(data as unknown as RecyclingInvoiceSnapshot,
      paper as RecyclingInvoicePaper);
    return new Response(html,{status:200,headers});
  }catch(error){
    return reject(409,error instanceof Error && error.message==="recycling_tax_invoice_snapshot_incomplete"
      ?"เอกสารภาษีมีข้อมูลไม่ครบ ต้องให้ฝ่ายบัญชีตรวจสอบ":"ไม่สามารถแสดงใบกำกับภาษี");
  }
}
