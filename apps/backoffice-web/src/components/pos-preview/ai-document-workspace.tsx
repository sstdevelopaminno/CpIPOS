"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AiDocument = {
  id: string;
  title: string;
  document_type: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  source_room_id: string | null;
  created_at: string;
  expires_at: string | null;
};
type Envelope<T>={data?:T|null;error?:{message?:string}|null};

function sizeText(bytes:number){
  if(bytes<1024) return `${bytes} B`;
  if(bytes<1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(1)} MB`;
}
function dateText(value:string|null){
  if(!value) return "ไม่กำหนด";
  const date=new Date(value); if(Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Bangkok"}).format(date);
}
function typeLabel(value:string){
  return ({ai_summary:"สรุป AI",sales_report:"รายงานยอดขาย",stock_report:"รายงานสต๊อก",marketing_plan:"แผนการตลาด",accounting_summary:"สรุปบัญชี",guide:"คู่มือ",other:"อื่น ๆ"} as Record<string,string>)[value]??value;
}

export function AiDocumentWorkspace(){
  const [documents,setDocuments]=useState<AiDocument[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [query,setQuery]=useState("");
  const [error,setError]=useState("");

  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const response=await fetch("/api/pos/ai/documents",{cache:"no-store"});
      const body=(await response.json().catch(()=>null)) as Envelope<{documents?:AiDocument[]}>|null;
      if(!response.ok) throw new Error(body?.error?.message??"โหลดเอกสารไม่สำเร็จ");
      setDocuments(Array.isArray(body?.data?.documents)?body!.data!.documents!:[]);
    }catch(e){setError(e instanceof Error?e.message:"โหลดเอกสารไม่สำเร็จ");}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{void load();},[load]);

  const rows=useMemo(()=>{
    const needle=query.trim().toLowerCase();
    if(!needle) return documents;
    return documents.filter((row)=>[row.title,row.file_name,typeLabel(row.document_type)].some((v)=>v.toLowerCase().includes(needle)));
  },[documents,query]);

  async function openDocument(row:AiDocument){
    setBusy(row.id);setError("");
    try{
      const response=await fetch(`/api/pos/ai/documents/${encodeURIComponent(row.id)}`,{cache:"no-store"});
      const body=(await response.json().catch(()=>null)) as Envelope<{url?:string}>|null;
      if(!response.ok||!body?.data?.url) throw new Error(body?.error?.message??"เปิดเอกสารไม่สำเร็จ");
      window.open(body.data.url,"_blank","noopener,noreferrer");
    }catch(e){setError(e instanceof Error?e.message:"เปิดเอกสารไม่สำเร็จ");}
    finally{setBusy(null);}
  }

  async function deleteDocument(row:AiDocument){
    if(!window.confirm(`ลบเอกสาร “${row.title}” หรือไม่?\n\nไฟล์นี้จะถูกลบออกจากพื้นที่เก็บเอกสารของร้าน`)) return;
    setBusy(row.id);setError("");
    try{
      const response=await fetch(`/api/pos/ai/documents/${encodeURIComponent(row.id)}`,{method:"DELETE"});
      const body=(await response.json().catch(()=>null)) as Envelope<{deleted?:boolean}>|null;
      if(!response.ok) throw new Error(body?.error?.message??"ลบเอกสารไม่สำเร็จ");
      setDocuments((current)=>current.filter((item)=>item.id!==row.id));
    }catch(e){setError(e instanceof Error?e.message:"ลบเอกสารไม่สำเร็จ");}
    finally{setBusy(null);}
  }

  return <main className="h-full min-h-0 overflow-y-auto bg-slate-50 p-3 sm:p-5">
    <section className="mx-auto min-h-full max-w-[1320px] rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-950">เก็บไฟล์เอกสาร</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">เอกสารที่บันทึกจาก CpiPOS AI แยกตามร้าน สาขา และผู้ใช้งาน พร้อมอายุเก็บตามแพ็กเกจ</p>
        </div>
        <button type="button" onClick={()=>void load()} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">รีเฟรช</button>
      </header>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="ค้นหาชื่อเอกสารหรือประเภท" className="min-w-[260px] flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-blue-300"/>
        <span className="text-xs font-semibold text-slate-500">{rows.length} ไฟล์</span>
      </div>
      {error?<div className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>:null}
      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
        <div className="grid grid-cols-[minmax(0,1fr)_140px_120px_170px_150px] bg-slate-50 px-4 py-3 text-xs font-black text-slate-500">
          <span>เอกสาร</span><span>ประเภท</span><span>ขนาด</span><span>สร้างเมื่อ</span><span className="text-right">จัดการ</span>
        </div>
        {loading?<div className="p-8 text-center text-sm text-slate-400">กำลังโหลดเอกสาร…</div>:
          rows.length?rows.map((row)=><div key={row.id} className="grid grid-cols-[minmax(0,1fr)_140px_120px_170px_150px] items-center border-t border-slate-100 px-4 py-3 text-sm">
            <div className="min-w-0"><strong className="block truncate text-slate-900">{row.title}</strong><span className="mt-0.5 block truncate text-[11px] text-slate-400">หมดอายุ {dateText(row.expires_at)}</span></div>
            <span className="text-xs font-semibold text-slate-600">{typeLabel(row.document_type)}</span>
            <span className="text-xs text-slate-500">{sizeText(row.size_bytes)}</span>
            <span className="text-xs text-slate-500">{dateText(row.created_at)}</span>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy===row.id} onClick={()=>void openDocument(row)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">เปิด</button>
              <button type="button" disabled={busy===row.id} onClick={()=>void deleteDocument(row)} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-600 disabled:opacity-50">ลบ</button>
            </div>
          </div>):<div className="p-10 text-center text-sm leading-6 text-slate-400">ยังไม่มีเอกสารที่บันทึกจาก AI<br/>เปิด CpiPOS AI แล้วกด “บันทึกเป็นเอกสาร” ใต้คำตอบที่ต้องการ</div>}
      </div>
    </section>
  </main>;
}
