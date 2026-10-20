"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import type {Language} from "@/lib/i18n";
import {PosOpticalCustomerModal} from "@/components/pos/pos-optical-customer-modal";
import {PosOpticalCustomerDetailDialog} from "@/components/pos/pos-optical-customer-detail-dialog";

type Customer={id:string;customer_code:string;full_name:string;phone:string|null;last_exam_date:string|null;examiner_name:string|null};
export function PosOpticalCustomersWorkspace({lang}:{lang:Language}){
  const [all,setAll]=useState<Customer[]>([]);
  const [search,setSearch]=useState("");
  const [open,setOpen]=useState(false);
  const [selectedCustomerId,setSelectedCustomerId]=useState<string|null>(null);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState("");
  const th=lang==="th",lo=lang==="lo";
  const reload=useCallback(async()=>{
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/pos/optical/customers",{credentials:"same-origin",cache:"no-store"});
      if(!response.ok)throw new Error(th?"ไม่สามารถโหลดข้อมูลลูกค้าของสาขานี้ได้":lo?"ບໍ່ສາມາດໂຫຼດລູກຄ້າໄດ້":"Unable to load branch customers");
      const body=await response.json() as {data?:{customers?:Customer[]}};
      setAll(body.data?.customers??[]);
    }catch(e){setAll([]);setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  },[th,lo]);
  useEffect(()=>{void reload();},[reload]);
  const filtered=useMemo(()=>all.filter(c=>
    [c.customer_code,c.full_name,c.phone??""].some(v=>v.toLowerCase().includes(search.trim().toLowerCase()))
  ),[all,search]);
  return <section className="mx-auto grid max-w-6xl gap-4" data-testid="pos-optical-customers-page">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
      <div>
        <p className="text-xs font-bold tracking-wider text-emerald-700">CUSTOM · OPTICAL</p>
        <h1 className="text-2xl font-bold text-slate-900">{th?"ลูกค้าแว่นตา":lo?"ລູກຄ້າແວ່ນຕາ":"Optical customers"}</h1>
        <p className="mt-1 text-sm text-slate-500">{th?"ข้อมูลชุดเดียวกับปุ่มเพิ่มประวัติลูกค้าในหน้าขาย · เห็นเฉพาะสาขาที่กำลังใช้งาน":lo?"ໃຊ້ຂໍ້ມູນຊຸດດຽວກັບໜ້າຂາຍ ແລະ ສາຂາປັດຈຸບັນ":"Shared with customer history on the sales screen, limited to the current branch"}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={()=>void reload()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">{th?"รีเฟรช":lo?"ໂຫຼດໃໝ່":"Refresh"}</button>
        <button type="button" onClick={()=>setOpen(true)} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white">{th?"+ เพิ่มประวัติลูกค้า":lo?"+ ເພີ່ມລູກຄ້າ":"+ Add customer history"}</button>
      </div>
    </header>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-3">
        <input aria-label={th?"ค้นหาลูกค้า":lo?"ຄົ້ນຫາລູກຄ້າ":"Search customers"}
          value={search} onChange={e=>setSearch(e.target.value)}
          placeholder={th?"ค้นหารหัส ชื่อ หรือเบอร์โทร":lo?"ຄົ້ນຫາ ລະຫັດ ຊື່ ເບີໂທ":"Customer code, name or phone"}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900" />
      </div>
      {error?<p role="alert" className="p-4 text-sm text-red-700">{error}</p>:null}
      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[650px] text-left text-sm">
          <thead className="bg-emerald-50 text-emerald-950"><tr>
            <th className="p-3">{th?"รหัส":lo?"ລະຫັດ":"Code"}</th>
            <th className="p-3">{th?"ชื่อลูกค้า":lo?"ຊື່ລູກຄ້າ":"Customer"}</th>
            <th className="p-3">{th?"โทรศัพท์":lo?"ເບີໂທ":"Phone"}</th>
            <th className="p-3">{th?"ตรวจสายตาล่าสุด":lo?"ກວດສາຍຕາຫຼ້າສຸດ":"Last exam"}</th>
            <th className="p-3">{th?"ผู้ตรวจ":lo?"ຜູ້ກວດ":"Examiner"}</th>
            <th className="p-3">{th?"จัดการ":"Actions"}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(c=><tr key={c.id} className="cursor-pointer hover:bg-emerald-50" onClick={()=>setSelectedCustomerId(c.id)} tabIndex={0}
              onKeyDown={e=>{if(e.key==="Enter")setSelectedCustomerId(c.id);}}>
              <td className="p-3 font-mono">{c.customer_code}</td>
              <td className="p-3 font-semibold">{c.full_name}</td>
              <td className="p-3">{c.phone||"—"}</td>
              <td className="p-3">{c.last_exam_date||"—"}</td>
              <td className="p-3">{c.examiner_name||"—"}</td>
              <td className="p-3"><button type="button" className="rounded-lg border border-emerald-300 px-3 py-1.5 font-semibold text-emerald-800"
                onClick={e=>{e.stopPropagation();setSelectedCustomerId(c.id);}}>{th?"ดู / แก้ไข / ลบ":"View / Edit / Archive"}</button></td>
            </tr>)}
            {!busy&&!filtered.length?<tr><td colSpan={6} className="p-8 text-center text-slate-500">{th?"ยังไม่พบลูกค้าในสาขานี้":lo?"ຍັງບໍ່ພົບລູກຄ້າ":"No customers in this branch"}</td></tr>:null}
            {busy?<tr><td colSpan={6} className="p-8 text-center text-slate-500">{th?"กำลังโหลด...":lo?"ກຳລັງໂຫຼດ...":"Loading..."}</td></tr>:null}
          </tbody>
        </table>
      </div>
    </div>
    <PosOpticalCustomerModal open={open} lang={lang} onClose={()=>{setOpen(false);void reload();}}/>
    {selectedCustomerId?<PosOpticalCustomerDetailDialog id={selectedCustomerId}
       onClose={()=>setSelectedCustomerId(null)} onChanged={()=>{void reload();}}/>:null}
  </section>;
}
