import {PosGuardError,requirePermission,requirePosSession} from "@/lib/pos-session-guard";
import {isAuthorizedRecyclingTenant} from "@/lib/server/recycling-pos-service";
import {loadRecyclingHistoryReport} from "@/lib/server/recycling-history-reports";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {loadReceiptStoreProfile} from "@/lib/services/store-profile-service";
import {renderRecyclingSharedReceipt} from "@/lib/printing/recycling-receipt-print-service";
import {composeRecyclingBatchReceipts,isRecyclingBatchPaper} from "@/lib/printing/recycling-batch-receipt-html";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'","Referrer-Policy":"no-referrer"};
function fail(status:number,message:string){return new Response(message,{status,headers:{...headers,"Content-Type":"text/plain; charset=utf-8"}});}
export async function GET(request:Request){
 try{
  const scope=await requirePosSession();
  requirePermission(scope,"sales:list:view");requirePermission(scope,"shift:join");
  if(!["owner","manager","staff","accountant"].includes(scope.session.role)||!await isAuthorizedRecyclingTenant(scope.session.tenant_id))return fail(403,"ไม่มีสิทธิ์พิมพ์บิล");
  const q=new URL(request.url).searchParams,paper=q.get("paper")??"a5";
  if(!isRecyclingBatchPaper(paper))return fail(422,"ขนาดกระดาษไม่ถูกต้อง");
  const report=await loadRecyclingHistoryReport(scope,"receipts",{period:q.get("period")??undefined,date:q.get("date")??undefined,from:q.get("from")??undefined,to:q.get("to")??undefined,branch:q.get("branch")??undefined,direction:q.get("direction")??undefined,status:q.get("status")??undefined,q:q.get("q")??undefined,page:"1"});
  const txs=report.transactions;
  if(!txs.length)return fail(404,"ไม่มีบิลตามตัวกรอง");
  const expected=Number(q.get("count"));
  if(!Number.isSafeInteger(expected)||expected!==txs.length)return fail(409,"จำนวนบิลเปลี่ยนแล้ว กรุณาคัดกรองใหม่ก่อนพิมพ์");
  const tenantId=scope.session.tenant_id,db=getSupabaseServiceClient();
  const branches=new Map(report.branchOptions.map(b=>[b.id,b.name]));
  const [tenant,profile]=await Promise.all([db.from("tenants").select("name,display_name").eq("id",tenantId).maybeSingle(),loadReceiptStoreProfile(tenantId)]);
  if(tenant.error||!tenant.data)return fail(503,"อ่านข้อมูลร้านไม่สำเร็จ");
  const html:string[]=[];let chars=0,lineCount=0;
  // Each receipt has at most 100 lines. Small batches avoid PostgREST row cap.
  for(let i=0;i<txs.length;i+=8){
   const batch=txs.slice(i,i+8),ids=batch.map(t=>t.id),branchIds=[...new Set(batch.map(t=>t.branch_id))];
   const [lines,current]=await Promise.all([
    db.from("recycling_transaction_lines").select("transaction_id,branch_id,line_no,sku_snapshot,name_snapshot,original_quantity,original_unit,base_unit,price_per_base,amount_minor",{count:"exact"}).eq("tenant_id",tenantId).in("branch_id",branchIds).in("transaction_id",ids).order("line_no").limit(800),
    db.from("recycling_transactions").select("id,branch_id,status,void_reason,total_minor,base_minor,vat_minor,tax_state,created_at").eq("tenant_id",tenantId).in("branch_id",branchIds).in("id",ids)
   ]);
   if(lines.error||current.error||lines.count===null||lines.count!==lines.data?.length||current.data?.length!==batch.length)return fail(409,"อ่านข้อมูลบิลไม่ครบ กรุณาลองใหม่");
   lineCount+=lines.data.length;if(lineCount>12000)return fail(413,"รายการวัสดุมากเกินไป กรุณาลดช่วงวันที่");
   for(const t of batch){
    const fresh=current.data.find(x=>x.id===t.id&&x.branch_id===t.branch_id);
    const items=lines.data.filter(l=>l.transaction_id===t.id&&l.branch_id===t.branch_id);
    if(!fresh||!branches.has(t.branch_id)||fresh.status!==t.status||fresh.created_at!==t.created_at||Number(fresh.total_minor)!==Number(t.total_minor)||fresh.base_minor!==t.base_minor||fresh.vat_minor!==t.vat_minor||fresh.tax_state!==t.tax_state||!items.length)return fail(409,"ข้อมูลบิลเปลี่ยนหรือไม่ครบ กรุณาคัดกรองใหม่");
    const total=Number(t.total_minor),base=Number(t.base_minor??total),vat=Number(t.vat_minor??0);
    if(!Number.isSafeInteger(total)||!Number.isSafeInteger(base)||!Number.isSafeInteger(vat)||base<0||vat<0||base+vat!==total||(t.direction==="buy"&&vat!==0)||(t.tax_state!=="vat_recorded"&&vat!==0)||items.some(l=>!Number.isSafeInteger(Number(l.amount_minor))||Number(l.amount_minor)<0)||items.reduce((s,l)=>s+Number(l.amount_minor),0)!==base)return fail(409,"ยอดบิลและรายละเอียดวัสดุไม่ตรงกัน จึงยังไม่พิมพ์ทั้งชุด");
    const receipt=renderRecyclingSharedReceipt({width:paper==="58"?58:80,shop:tenant.data.display_name||tenant.data.name||profile?.display_name||profile?.name||"ร้านวัสดุรีไซเคิล",branch:branches.get(t.branch_id)!,receiptNo:t.receipt_no,direction:t.direction,status:t.status,voidReason:fresh.void_reason,createdAt:t.created_at,counterparty:t.counterparty_name||"-",settlement:t.settlement,totalMinor:total,baseMinor:base,vatMinor:vat,taxState:t.tax_state,lines:items,storeAddress:profile?.company_address??null,storePhone:profile?.contact_phone??null,logoUrl:profile?.logo_url??null});
    chars+=receipt.length;if(chars>4000000)return fail(413,"เอกสารจำนวนมากเกินไป กรุณาลดช่วงวันที่");
    html.push(receipt);
   }
  }
  return new Response(composeRecyclingBatchReceipts(html,paper),{headers:{...headers,"Content-Type":"text/html; charset=utf-8"}});
 }catch(e){if(e instanceof PosGuardError)return fail(e.status,e.message);return fail(503,"ไม่สามารถเตรียมบิลทั้งหมดได้ กรุณาตรวจสอบตัวกรองหรือการเชื่อมต่อ");}
}
