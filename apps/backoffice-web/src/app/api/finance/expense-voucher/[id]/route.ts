import {randomUUID} from "node:crypto";
import {expenseVoucherLogoUrl} from "@/lib/printing/expense-voucher-logo";
import {loadReceiptStoreProfile} from "@/lib/services/store-profile-service";
import {accountingIdentity,accountingDocumentDetail,FinanceAccountingError} from "@/lib/server/finance-accounting-workflow";
import {getPrimarySupabaseServiceClient} from "@/lib/supabase-admin";
import {isAuthorizedRecyclingTenant} from "@/lib/server/recycling-pos-service";
export const dynamic="force-dynamic";
const escape=(value:unknown)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]??c));
const noCache={"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"};
const reject=(message:string,status:number)=>new Response(message,{status,headers:{...noCache,"Content-Type":"text/plain; charset=utf-8"}});
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const size=new URL(request.url).searchParams.get("size")??"A4";
  if(size!=="A4"&&size!=="A5")return reject("ขนาดกระดาษไม่ถูกต้อง",422);
  const identity=await accountingIdentity("finance.expenses");
  if(!await isAuthorizedRecyclingTenant(identity.tenantId))return reject("ไม่มีสิทธิ์",403);
  const {id}=await params;
  const detail=await accountingDocumentDetail(identity,id);
  const d=detail.document;
  if(d.kind!=="expense_voucher"||d.status!=="issued"||!d.approvedBy)return reject("ต้องออกเอกสารที่ผ่านอนุมัติแล้วเท่านั้น",409);
  const db=getPrimarySupabaseServiceClient();
  const [branch,snapshot,profile]=await Promise.all([
    db.from("branches").select("name,code").eq("tenant_id",identity.tenantId).eq("id",d.branchId).maybeSingle(),
    db.from("finance_accounting_documents").select("request_snapshot,version,status").eq("tenant_id",identity.tenantId).eq("branch_id",d.branchId).eq("id",d.id).maybeSingle(),
    loadReceiptStoreProfile(identity.tenantId)
  ]);
  if(branch.error||snapshot.error||!branch.data||!snapshot.data||snapshot.data.status!=="issued"||snapshot.data.version!==d.version)return reject("เอกสารเปลี่ยนแปลง กรุณาเปิดใหม่",409);
  if(!profile||!(profile.display_name||profile.name))return reject("ยังไม่สามารถยืนยันชื่อร้านค้า กรุณาตรวจสอบเมนูตั้งชื่อร้านค้า / บริษัท",503);
  const logo=expenseVoucherLogoUrl(profile.logo_url);
  const logoHtml=logo?"<img id=\'store-logo\' class=\'store-logo\' alt=\'โลโก้ร้านค้า\' referrerpolicy=\'no-referrer\' src=\'"+escape(logo)+"\'>":"";
  const evidence=snapshot.data.request_snapshot as {evidenceRef?:unknown;evidenceType?:unknown}|null;
  const methods:Record<string,string>={cash_count:"เงินสด",bank_transfer:"เงินโอน",cheque:"เช็ค",card:"บัตร"};
  const method=typeof evidence?.evidenceType==="string"?methods[evidence.evidenceType]:undefined;
  const reference=typeof evidence?.evidenceRef==="string"?evidence.evidenceRef:"";
  if(!method||!reference.trim()||!Number.isSafeInteger(d.amountMinor)||d.amountMinor<=0||!detail.lines.length||detail.lines.some(l=>!Number.isSafeInteger(l.totalMinor)||l.totalMinor<=0||!Number.isSafeInteger(l.unitMinor)||l.unitMinor<0||!Number.isFinite(l.quantity)||l.quantity<=0)||detail.lines.reduce((sum,l)=>sum+l.totalMinor,0)!==d.amountMinor)return reject("หลักฐานหรือยอดเอกสารไม่ครบถ้วน ไม่สามารถพิมพ์ได้",409);
  const digits=d.currency==="LAK"?0:2;
  const money=(v:number)=>new Intl.NumberFormat("th-TH",{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(v/(digits===0?1:100));
  const nonce=randomUUID().replaceAll("-","");
  const rows=detail.lines.map(l=>"<tr><td>"+escape(l.no)+"</td><td>"+escape(l.description)+"</td><td class='num'>"+escape(l.quantity)+"</td><td class='num'>"+escape(money(l.unitMinor))+"</td><td class='num'>"+escape(money(l.totalMinor))+"</td></tr>").join("");
  const html="<!doctype html><html lang='th'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>ใบสำคัญจ่าย "+escape(d.number)+"</title><style nonce='"+nonce+"'>@page{size:"+size+" portrait;margin:12mm}*{box-sizing:border-box}body{font-family:Tahoma,'Noto Sans Thai',sans-serif;color:#172033;margin:0;background:#eef2f6;font-size:"+ (size==="A5"?"11":"13")+"px}.tools{padding:12px;text-align:center;background:white;border-bottom:1px solid #cbd5e1}.tools button{padding:9px 18px;background:#1658a4;color:white;border:0;border-radius:5px;cursor:pointer}.sheet{background:white;max-width:"+(size==="A5"?"148":"210")+"mm;margin:12px auto;padding:12mm}h1{text-align:center;margin:0;font-size:22px;color:#164d87}h2{font-size:13px;margin:0 0 12px;text-align:center;font-weight:400}p{margin:6px 0;overflow-wrap:anywhere}.store-logo{display:block;max-width:"+(size==="A5"?"35":"48")+"mm;max-height:"+(size==="A5"?"18":"24")+"mm;width:auto;height:auto;object-fit:contain;margin:0 auto 3mm}.address{white-space:pre-wrap}.company{text-align:center;font-weight:bold;font-size:14px}.address{text-align:center;font-size:11px}.full{grid-column:1/-1}.col-no{width:8%}.col-desc{width:38%}.col-qty{width:14%}.col-price,.col-total{width:20%}.meta{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px;margin:14px 0;border-top:2px solid #164d87;padding-top:10px}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:10px 0}th,td{border:1px solid #aab5c5;padding:6px;overflow-wrap:anywhere;vertical-align:top}th{background:#e6eef8;text-align:left}.num{text-align:right;font-variant-numeric:tabular-nums}.total{border:1px solid #aab5c5;padding:10px;text-align:right;font-weight:bold;font-size:16px}.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center;margin-top:32px;break-inside:avoid}.sig{padding-top:22px;border-bottom:1px solid #777;margin-bottom:6px}.note{font-size:10px;color:#475569;margin-top:14px}@media print{body{background:white}.tools{display:none}.sheet{max-width:none;margin:0;padding:0}thead{display:table-header-group}tr{break-inside:avoid}.total{break-inside:avoid}}</style></head><body><div class='tools'><button id='print' type='button'>พิมพ์ / บันทึก PDF ("+size+")</button></div><main class='sheet'>"+logoHtml+"<h1>ใบสำคัญจ่าย</h1><h2>PAYMENT VOUCHER · CpiPOS FINANCE</h2><p class='company'>"+escape(profile.display_name||profile.name)+"</p><p class='address'>"+escape(profile.company_address||"")+" "+escape(profile.contact_phone||"")+"</p><section class='meta'><p>สาขา: "+escape(branch.data.name)+" ("+escape(branch.data.code)+")</p><p>เลขที่: "+escape(d.number)+"</p><p>ผู้รับเงิน: "+escape(d.party)+"</p><p>วันที่เอกสาร: "+escape(d.date)+"</p><p>วิธีจ่าย: "+escape(method)+"</p><p>สกุลเงิน: "+escape(d.currency)+"</p><p class='full'>หลักฐานอ้างอิง: "+escape(reference)+"</p></section><table><thead><tr><th class='col-no'>ที่</th><th class='col-desc'>รายการ</th><th class='col-qty'>จำนวน</th><th class='col-price'>ราคาต่อหน่วย</th><th class='col-total'>จำนวนเงิน</th></tr></thead><tbody>"+rows+"</tbody></table><div class='total'>รวมเงิน "+escape(money(d.amountMinor))+" "+escape(d.currency)+"</div><section class='sign'><div><div class='sig'></div>ผู้จัดทำ</div><div><div class='sig'></div>ผู้อนุมัติ</div><div><div class='sig'></div>ผู้รับเงิน</div></section><p class='note'>เอกสารประกอบการจ่ายเงินภายใน ไม่ใช่ใบกำกับภาษีหรือหลักฐานยืนยันเงินออกจากธนาคารโดยอัตโนมัติ · พิมพ์ซ้ำไม่สร้างรายการบัญชีใหม่</p></main><script nonce='"+nonce+"'>const button=document.getElementById('print');const logo=document.getElementById('store-logo');button.addEventListener('click',()=>{if(logo&&!logo.complete){alert('กำลังโหลดโลโก้ กรุณารอให้ภาพแสดงก่อนพิมพ์');return;}if(logo&&!logo.naturalWidth){alert('ไม่สามารถโหลดโลโก้ร้านค้าได้ กรุณาตรวจสอบการตั้งค่า');return;}window.print();});</script></body></html>";
  return new Response(html,{headers:{...noCache,"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":"default-src 'none'; img-src 'self' data: https: http:; script-src 'nonce-"+nonce+"'; style-src 'nonce-"+nonce+"'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}});
 }catch(e){return reject("ไม่สามารถเปิดใบสำคัญจ่ายได้",e instanceof FinanceAccountingError?e.status:503);}
}
