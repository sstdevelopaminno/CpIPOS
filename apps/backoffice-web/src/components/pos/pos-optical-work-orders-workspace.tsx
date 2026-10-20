"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import type {Language} from "@/lib/i18n";
import {PosOpticalWorkOrderDetailDialog} from "@/components/pos/pos-optical-work-order-detail-dialog";

type Job={id:string;status:string;currency_code:string;total_amount:number;paid_total:number;created_at:string;due_at:string|null;
  customer:{full_name:string;customer_code:string}|null};
const statusTh:Record<string,string>={
  received:"รับงานแล้ว",lens_ordered:"สั่งเลนส์",edging:"ประกอบแว่น",ready_for_pickup:"พร้อมรับ",collected:"ส่งมอบแล้ว",cancelled:"ยกเลิก"
};
export function PosOpticalWorkOrdersWorkspace({lang}:{lang:Language}){
  const [jobs,setJobs]=useState<Job[]>([]);
  const [search,setSearch]=useState("");
  const [selectedOrderId,setSelectedOrderId]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const th=lang==="th",lo=lang==="lo";
  const refresh=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const response=await fetch("/api/pos/optical/work-orders/overview",{credentials:"same-origin",cache:"no-store"});
      if(!response.ok)throw new Error(th?"ไม่สามารถโหลดใบสั่งงานในสาขานี้ได้":lo?"ໂຫຼດໃບສັ່ງງານບໍ່ໄດ້":"Cannot load branch work orders");
      const body=await response.json() as {data?:{orders?:Job[]}};
      setJobs(body.data?.orders??[]);
    }catch(e){setJobs([]);setError(e instanceof Error?e.message:String(e));}
    finally{setLoading(false);}
  },[th,lo]);
  useEffect(()=>{void refresh();},[refresh]);
  const filtered=useMemo(()=>jobs.filter(job=>
    [job.id,job.customer?.full_name??"",job.customer?.customer_code??"",job.status]
      .some(x=>x.toLowerCase().includes(search.trim().toLowerCase()))
  ),[jobs,search]);
  return <section data-testid="pos-optical-work-orders-page" className="mx-auto grid max-w-6xl gap-4">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
      <div>
        <p className="text-xs font-bold tracking-wider text-emerald-700">CUSTOM · OPTICAL</p>
        <h1 className="text-2xl font-bold text-slate-900">{th?"ใบสั่งงาน":lo?"ໃບສັ່ງງານ":"Work orders"}</h1>
        <p className="mt-1 text-sm text-slate-500">{th?"งานสั่งทำแว่นเฉพาะบุคคล · ข้อมูลใบงานของสาขาปัจจุบัน (ไม่ใช่บิลขายสินค้าทั่วไป)":lo?"ໃບສັ່ງເຮັດແວ່ນສະເພາະ ສາຂາປັດຈຸບັນ":"Made-to-order spectacles from the current branch, not normal retail sales"}</p>
      </div>
      <button onClick={()=>void refresh()} type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">{th?"รีเฟรช":lo?"ໂຫຼດໃໝ່":"Refresh"}</button>
    </header>
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{th
      ?"หน้านี้แสดงใบงานเดิมเท่านั้น การสร้างใบงาน รับมัดจำ รับเงินคงเหลือและส่งมอบยังอยู่ในขั้นทดสอบ ไม่เปลี่ยนธุรกรรมจากหน้านี้"
      :lo?"ເບິ່ງໃບງານໄດ້ເທົ່ານັ້ນ ການຮັບເງິນຍັງບໍ່ເປີດ":"This is a read-only work-order list. Issuing jobs, taking deposits and collecting payment remain separately gated."}</p>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-3">
        <input value={search} onChange={e=>setSearch(e.target.value)} aria-label={th?"ค้นหาใบสั่งงาน":"Search work orders"}
          placeholder={th?"ค้นหาเลขใบงาน รหัสหรือชื่อลูกค้า":lo?"ຄົ້ນຫາໃບສັ່ງງານ":"Work order number or customer"}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      </div>
      {error?<p role="alert" className="p-3 text-sm font-semibold text-red-700">{error}</p>:null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead className="bg-emerald-50 text-emerald-950"><tr>
            <th className="p-3">{th?"เลขใบงาน":"Order"}</th>
            <th className="p-3">{th?"ลูกค้า":"Customer"}</th>
            <th className="p-3">{th?"สถานะ":"Status"}</th>
            <th className="p-3">{th?"ยอดรวม (LAK)":"Total (LAK)"}</th>
            <th className="p-3">{th?"มัดจำ/ชำระแล้ว":"Paid"}</th>
            <th className="p-3">{th?"ค้างชำระ":"Outstanding"}</th>
            <th className="p-3">{th?"นัดรับ":"Due"}</th><th className="p-3">{th?"จัดการ":"Actions"}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(job=><tr key={job.id} tabIndex={0} onClick={()=>setSelectedOrderId(job.id)}
              onKeyDown={e=>{if(e.key==="Enter")setSelectedOrderId(job.id);}}
              className="cursor-pointer hover:bg-emerald-50">
              <td className="p-3 font-mono text-xs" title={job.id}>{job.id.slice(0,8).toUpperCase()}</td>
              <td className="p-3"><span className="font-semibold">{job.customer?.full_name||"—"}</span><span className="block text-xs text-slate-500">{job.customer?.customer_code||""}</span></td>
              <td className="p-3">{th?statusTh[job.status]??job.status:job.status}</td>
              <td className="p-3 text-right tabular-nums">{Number(job.total_amount).toLocaleString("en-US")}</td>
              <td className="p-3 text-right tabular-nums">{Number(job.paid_total).toLocaleString("en-US")}</td>
              <td className="p-3 text-right tabular-nums">{Math.max(0,Number(job.total_amount)-Number(job.paid_total)).toLocaleString("en-US")}</td>
              <td className="p-3">{job.due_at?.slice(0,10)||"—"}</td>
              <td className="p-3"><button type="button" className="rounded-lg border border-emerald-300 px-3 py-2 font-bold text-emerald-800"
                 onClick={e=>{e.stopPropagation();setSelectedOrderId(job.id);}}>ดู / แก้ไข / ลบ</button></td>
            </tr>)}
            {!loading&&!filtered.length?<tr><td colSpan={8} className="p-8 text-center text-slate-500">{th?"ยังไม่มีใบสั่งงานในสาขานี้":lo?"ຍັງບໍ່ມີໃບສັ່ງງານ":"No work orders for this branch"}</td></tr>:null}
            {loading?<tr><td colSpan={8} className="p-8 text-center text-slate-500">{th?"กำลังโหลด...":"Loading..."}</td></tr>:null}
          </tbody>
        </table>
      </div>
    </div>
    {selectedOrderId?<PosOpticalWorkOrderDetailDialog id={selectedOrderId}
      onClose={()=>setSelectedOrderId(null)} onChanged={()=>{void refresh();}}/>:null}
  </section>;
}
