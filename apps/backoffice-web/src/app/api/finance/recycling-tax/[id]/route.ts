import {recyclingFinanceTaxIdentity} from "@/lib/server/recycling-finance-tax-identity";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {renderRecyclingTaxInvoiceHtml,type RecyclingInvoicePaper,type RecyclingInvoiceSnapshot} from "@/lib/recycling-tax-invoice";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"};
const reject=(message:string,status:number)=>new Response(message,{status,headers:{...headers,"Content-Type":"text/plain; charset=utf-8"}});
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const identity=await recyclingFinanceTaxIdentity();if(!identity)return reject("ไม่มีสิทธิ์เข้าถึง",403);
  const {id}=await params,paper=new URL(request.url).searchParams.get("paper")??"a4";
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||!["a4","a5","58","80"].includes(paper))return reject("ข้อมูลเอกสารไม่ถูกต้อง",422);
  const {data,error}=await getSupabaseServiceClient().from("recycling_tax_invoices").select("id,invoice_no,issued_at,seller_snapshot,buyer_snapshot,items_snapshot,tax_snapshot").eq("tenant_id",identity.tenantId).in("branch_id",identity.branchIds).eq("id",id).eq("status","issued").maybeSingle();
  if(error)return reject("ไม่สามารถอ่านใบกำกับภาษี",503);
  if(!data)return reject("ไม่พบใบกำกับภาษีที่มีผลในสาขาที่ได้รับสิทธิ์",404);
  return new Response(renderRecyclingTaxInvoiceHtml(data as unknown as RecyclingInvoiceSnapshot,paper as RecyclingInvoicePaper),{headers:{...headers,"Content-Type":"text/html; charset=utf-8"}});
 }catch{return reject("ข้อมูลเอกสารไม่ครบ กรุณาตรวจสอบกับฝ่ายบัญชี",409);}
}
