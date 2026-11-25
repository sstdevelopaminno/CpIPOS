import "server-only";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import type {FinanceIdentity} from "@/lib/server/finance-session";
import {formatRecyclingMoney} from "@/lib/recycling-money-display";
export async function RecyclingAccountantOverview({identity}:{identity:FinanceIdentity}){
 if(!identity.branchIds.length)return null;
 const db=getSupabaseServiceClient();
 const [tx,branches,pending]=await Promise.all([
  db.from("recycling_transactions").select("id,branch_id,receipt_no,direction,settlement,total_minor,vat_minor,status,finance_document_id,created_at",{count:"exact"}).eq("tenant_id",identity.tenantId).in("branch_id",identity.branchIds).order("created_at",{ascending:false}).order("id",{ascending:false}).limit(30),
  db.from("branches").select("id,name").eq("tenant_id",identity.tenantId).in("id",identity.branchIds),
  db.from("recycling_transactions").select("id",{count:"exact",head:true}).eq("tenant_id",identity.tenantId).in("branch_id",identity.branchIds).eq("status","posted").is("finance_document_id",null)
 ]);
 if(tx.error||branches.error||pending.error||tx.count===null||pending.count===null)return <section role="alert" className="border-b border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">ยังโหลดข้อมูลบัญชี Recycling ไม่สำเร็จ ไม่แสดงยอด 0 แทนข้อมูลที่ขาดหาย</section>;
 const names=new Map((branches.data??[]).map(b=>[String(b.id),String(b.name)]));
 const rows=tx.data??[];
 const money=(minor:unknown)=>minor===null||minor===undefined?"—":formatRecyclingMoney(Number(minor)/100);
 return <section className="space-y-3 border-b border-slate-200 bg-white p-4 text-slate-900" data-testid="recycling-accountant-overview">
   <div className="flex flex-wrap items-center justify-between gap-2">
    <div><p className="text-xs font-bold tracking-wider text-blue-700">CpiPOS FINANCE · RECYCLING</p><h1 className="text-lg font-extrabold">ภาพรวมบัญชีรับซื้อ–ขายวัสดุ</h1><p className="text-xs text-slate-600">ข้อมูลจากธุรกรรมต้นทางของทุกสาขาที่ได้รับสิทธิ์ · อ่านอย่างเดียว</p></div>
   </div>
   <div className="grid gap-2 sm:grid-cols-3">
    <div className="rounded-md border border-slate-200 p-3"><p className="text-xs text-slate-500">ธุรกรรมสะสม (รวม VOID)</p><strong className="text-xl tabular-nums">{tx.count.toLocaleString("th-TH")}</strong></div>
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3"><p className="text-xs text-amber-800">รายการรอตรวจสอบก่อนโพสต์ GL</p><strong className="text-xl tabular-nums text-amber-900">{pending.count.toLocaleString("th-TH")}</strong></div>
    <div className="rounded-md border border-slate-200 p-3"><p className="text-xs text-slate-500">สาขาที่ได้รับสิทธิ์</p><strong className="text-xl tabular-nums">{identity.branchIds.length.toLocaleString("th-TH")}</strong></div>
   </div>
   <div className="overflow-x-auto rounded-md border border-slate-200">
    <table className="w-full min-w-[850px] text-sm">
     <caption className="p-3 text-left text-xs text-slate-600">ธุรกรรมล่าสุด {rows.length} รายการ จากทั้งหมด {tx.count} รายการ · ไม่ใช่ยอดรวมทั้งงวด</caption>
     <thead className="bg-slate-100 text-left text-xs"><tr>{["วันที่ / เลขที่บิล","สาขา","รายการ","ชำระเงิน","ยอดรวม (บาท)","VAT (บาท)","สถานะบัญชี"].map((label,i)=><th key={label} className={"p-3 "+(i===4||i===5?"text-right":"")}>{label}</th>)}</tr></thead>
     <tbody>{rows.map(row=><tr key={row.id} className="border-t border-slate-100">
      <td className="p-3"><strong>{row.receipt_no}</strong><p className="text-xs text-slate-500">{new Date(row.created_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p></td>
      <td className="p-3">{names.get(String(row.branch_id))??"ไม่ระบุสาขา"}</td><td className="p-3">{row.direction==="buy"?"รับซื้อ":"ขายออก"}</td>
      <td className="p-3">{row.settlement==="cash"?"เงินสด":row.settlement==="bank_transfer"?"เงินโอน":row.settlement==="credit"?"เครดิต":row.settlement}</td>
      <td className="p-3 text-right tabular-nums">{money(row.total_minor)}</td><td className="p-3 text-right tabular-nums">{money(row.vat_minor)}</td>
      <td className="p-3">{row.status==="voided"?<span className="font-bold text-rose-700">VOID</span>:row.finance_document_id?<span className="font-bold text-emerald-700">โพสต์แล้ว</span>:<span className="font-bold text-amber-700">รอตรวจสอบ</span>}</td>
     </tr>)}{!rows.length&&<tr><td colSpan={7} className="p-8 text-center text-slate-500">ยังไม่มีธุรกรรม Recycling</td></tr>}</tbody>
    </table>
   </div>
 </section>;
}
