import {fail,ok} from "@/lib/http";
import {recyclingFinanceTaxIdentity} from "@/lib/server/recycling-finance-tax-identity";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {todayBangkok} from "@/lib/finance-sales-analytics";
import {validateOverviewDates} from "@/lib/recycling-finance-overview";
export const dynamic="force-dynamic";
const PAGE=50;
export async function GET(request:Request){
 try{
  const identity=await recyclingFinanceTaxIdentity();
  if(!identity)return fail("finance_tax_forbidden","ไม่มีสิทธิ์เข้าถึงทะเบียนภาษี",403);
  const p=new URL(request.url).searchParams,today=todayBangkok(),from=p.get("from")??today.slice(0,7)+"-01",to=p.get("to")??today,branch=p.get("branchId")||"",mode=p.get("mode")??"invoices",page=Number(p.get("page")??1),q=(p.get("q")??"").trim();
  if(branch&&!identity.branchIds.includes(branch))return fail("finance_branch_forbidden","ไม่มีสิทธิ์เข้าถึงสาขา",403);
  if(!["invoices","sales"].includes(mode)||!Number.isSafeInteger(page)||page<1||page>1000||q.length>80)return fail("finance_tax_filter_invalid","ตัวกรองไม่ถูกต้อง",422);
  let range:ReturnType<typeof validateOverviewDates>;
  try{range=validateOverviewDates(from,to,today);}catch{return fail("finance_tax_date_invalid","กรุณาตรวจสอบช่วงวันที่",422);}
  const db=getSupabaseServiceClient(),ids=branch?[branch]:identity.branchIds;
  const invoices=mode==="invoices";
  const invoiceQuery=db.from("recycling_tax_invoices").select("id,branch_id,invoice_no,issued_at,status,buyer_snapshot,tax_snapshot",{count:"exact"}).eq("tenant_id",identity.tenantId).in("branch_id",ids).gte("issued_at",range.start).lt("issued_at",range.end);
  const salesQuery=db.from("recycling_transactions").select("id,branch_id,receipt_no,created_at,status,counterparty_name,base_minor,vat_minor,total_minor,tax_state",{count:"exact"}).eq("tenant_id",identity.tenantId).in("branch_id",ids).eq("direction","sell").eq("status","posted").eq("tax_state","vat_recorded").gte("created_at",range.start).lt("created_at",range.end);
  // Exact identifier lookup avoids wildcard injection and full-table scans.
  const [result,branches]=await Promise.all([
   invoices?(q?invoiceQuery.eq("invoice_no",q):invoiceQuery).order("issued_at",{ascending:false}).order("id",{ascending:false}).range((page-1)*PAGE,page*PAGE-1):
   (q?salesQuery.eq("receipt_no",q):salesQuery).order("created_at",{ascending:false}).order("id",{ascending:false}).range((page-1)*PAGE,page*PAGE-1),
   db.from("branches").select("id,name").eq("tenant_id",identity.tenantId).in("id",identity.branchIds).order("name")
  ]);
  if(result.error||branches.error||result.count===null)return fail("finance_tax_unavailable","ยังไม่สามารถอ่านทะเบียนภาษีได้",503);
  const rows=(result.data??[]).map(r=>{
   if("invoice_no" in r){
    const tax=r.tax_snapshot as {receipt_no?:string;base_minor?:number;vat_minor?:number;total_minor?:number}|null;
    const buyer=r.buyer_snapshot as {display_name?:string}|null;
    return {id:r.id,branchId:r.branch_id,number:r.invoice_no,receiptNo:tax?.receipt_no??"",date:r.issued_at,status:r.status,buyer:buyer?.display_name??"",base:tax?.base_minor??null,vat:tax?.vat_minor??null,total:tax?.total_minor??null};
   }
   return {id:r.id,branchId:r.branch_id,number:r.receipt_no,receiptNo:r.receipt_no,date:r.created_at,status:r.status,buyer:r.counterparty_name??"",base:r.base_minor,vat:r.vat_minor,total:r.total_minor};
  });
  const response=ok({rows,branches:branches.data??[],count:result.count,page,pageSize:PAGE,from,to});
  response.headers.set("Cache-Control","private, no-store, max-age=0");return response;
 }catch{return fail("finance_tax_unavailable","ไม่สามารถยืนยันทะเบียนภาษีได้",503);}
}
