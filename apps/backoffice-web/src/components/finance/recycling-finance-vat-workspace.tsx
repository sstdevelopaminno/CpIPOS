"use client";
import {useState} from "react";
import {RecyclingVatSetup} from "@/components/pos/recycling-vat-setup";
export function RecyclingFinanceVatWorkspace({branches}:{branches:{id:string;name:string}[]}){
 const [branchId,setBranchId]=useState(branches[0]?.id??"");
 const selected=branches.find(b=>b.id===branchId);
 return <section className="space-y-3 border-b border-slate-200 p-4">
  <label className="flex flex-wrap items-center gap-2 text-sm font-bold">สาขาสำหรับยืนยัน VAT
   <select value={branchId} onChange={e=>setBranchId(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2">
    {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
   </select>
  </label>
  {selected?<RecyclingVatSetup key={branchId} endpoint={"/api/pos/recycling/vat/setup?finance=1&branch_id="+encodeURIComponent(branchId)}/>:<p role="alert" className="text-sm text-amber-900">ไม่พบสาขาที่ได้รับสิทธิ์</p>}
 </section>;
}
