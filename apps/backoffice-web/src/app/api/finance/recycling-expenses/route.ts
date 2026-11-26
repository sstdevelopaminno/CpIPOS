import {fail,ok} from "@/lib/http";
import {requireFinanceSession} from "@/lib/server/finance-session";
import {getTenantPosMenuOverrides} from "@/lib/server/pos-menu-policy-service";
import {isAccountantMenuVisible} from "@/lib/accountant-menu-policy";
import {isAuthorizedRecyclingTenant} from "@/lib/server/recycling-pos-service";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {todayBangkok} from "@/lib/finance-sales-analytics";
import {validateOverviewDates} from "@/lib/recycling-finance-overview";
export const dynamic="force-dynamic";
const PAGE=50;
export async function GET(request:Request){
 try{
  const identity=await requireFinanceSession();
  if(!identity)return fail("finance_session_required","กรุณาเข้าสู่ระบบบัญชี",401);
  if(!isAccountantMenuVisible("finance.expenses",await getTenantPosMenuOverrides(identity.tenantId))||!await isAuthorizedRecyclingTenant(identity.tenantId))return fail("finance_expense_forbidden","ไม่มีสิทธิ์เข้าถึงทะเบียนรายจ่ายนี้",403);
  const params=new URL(request.url).searchParams,today=todayBangkok();
  const from=params.get("from")??today,to=params.get("to")??today;
  let range:ReturnType<typeof validateOverviewDates>;
  try{range=validateOverviewDates(from,to,today);}catch{return fail("invalid_date","กรุณาตรวจสอบช่วงวันที่ (สูงสุด 366 วัน)",422);}
  const branch=params.get("branchId")||"",method=params.get("method")||"",page=Number(params.get("page")??1);
  if(branch&&!identity.branchIds.includes(branch))return fail("branch_forbidden","ไม่มีสิทธิ์เข้าถึงสาขา",403);
  if(!Number.isSafeInteger(page)||page<1||page>1000||!["","cash","bank_transfer","credit"].includes(method))return fail("invalid_filter","ตัวกรองไม่ถูกต้อง",422);
  const db=getSupabaseServiceClient();
  const correctionEnabled=process.env.RECYCLING_MANUAL_DOCUMENT_TIME_ENABLED==="1";
  const dateColumn=correctionEnabled?"effective_document_at":"created_at";
  let query=db.from("recycling_transactions").select(correctionEnabled?"id,branch_id,receipt_no,created_at:effective_document_at,counterparty_name,settlement,base_minor,vat_minor,total_minor,finance_document_id":"id,branch_id,receipt_no,created_at,counterparty_name,settlement,base_minor,vat_minor,total_minor,finance_document_id",{count:"exact"})
   .eq("tenant_id",identity.tenantId).in("branch_id",branch?[branch]:identity.branchIds).eq("direction","buy").eq("status","posted").gte(dateColumn,range.start).lt(dateColumn,range.end);
  if(method)query=query.eq("settlement",method);
  const [result,branches]=await Promise.all([query.order(dateColumn,{ascending:false}).order("id",{ascending:false}).range((page-1)*PAGE,page*PAGE-1),
   db.from("branches").select("id,name").eq("tenant_id",identity.tenantId).in("id",identity.branchIds).order("name")]);
  if(result.error||branches.error||result.count===null)return fail("expense_unavailable","ยังไม่สามารถอ่านทะเบียนรับซื้อได้",503);
  const rows=result.data??[];
  const sums={base:0,vat:0,total:0,paid:0};
  for(const row of rows){
   const total=Number(row.total_minor),vat=Number(row.vat_minor??0),base=Number(row.base_minor??total);
   if(![total,vat,base].every(x=>Number.isSafeInteger(x)&&x>=0)||base+vat!==total)throw Error("invalid amount");
   sums.base+=base;sums.vat+=vat;sums.total+=total;
   if(["cash","bank_transfer"].includes(row.settlement))sums.paid+=total;
  }
  if(!Object.values(sums).every(Number.isSafeInteger))throw Error("sum overflow");
  const response=ok({rows,branches:branches.data??[],count:result.count,page,pageSize:PAGE,sums,from,to,correctionEnabled,amountCorrectionEnabled:correctionEnabled&&process.env.RECYCLING_AMOUNT_CORRECTION_ENABLED==="1"});
  response.headers.set("Cache-Control","private, no-store");return response;
 }catch{return fail("expense_unavailable","ไม่สามารถยืนยันข้อมูลรายจ่ายได้ กรุณารีเฟรช",503);}
}
