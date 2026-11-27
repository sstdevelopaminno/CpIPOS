"use client";
import {useRef,useState} from "react";
import type {RecyclingBatchPaper} from "@/lib/printing/recycling-batch-receipt-html";
export function RecyclingBatchPrint({filters,count}:{filters:string;count:number}){
 const [open,setOpen]=useState(false),[paper,setPaper]=useState<RecyclingBatchPaper>("a5"),[ready,setReady]=useState(false),[error,setError]=useState("");
 const frame=useRef<HTMLIFrameElement>(null);
 const src="/api/pos/recycling/receipts/batch-preview?"+filters+"&count="+count+"&paper="+paper;
 function loaded(){
  const doc=frame.current?.contentDocument;
  if(doc?.body?.dataset.recyclingBatchReady==="true"&&Number(doc.body.dataset.receiptCount)===count){setReady(true);setError("");}
  else {setReady(false);setError(doc?.body?.textContent?.trim().slice(0,250)||"ไม่สามารถเตรียมบิลครบทั้งชุด");}
 }
 async function print(){
  const w=frame.current?.contentWindow,d=frame.current?.contentDocument;
  if(!ready||!w||!d||Number(d.body.dataset.receiptCount)!==count)return;
  await Promise.all(Array.from(d.images,img=>img.decode().catch(()=>undefined)));
  if(frame.current?.contentWindow!==w)return;
  w.focus();w.print();
 }
 return <><button type="button" disabled={!count} onClick={()=>{setReady(false);setError("");setOpen(true);}} data-testid="recycling-batch-print" className="min-h-10 rounded-lg bg-blue-700 px-3 text-xs font-bold text-white hover:bg-blue-800 disabled:opacity-40">พิมพ์บิลทั้งหมด ({count})</button>
 {open&&<div role="presentation" className="fixed inset-0 z-[1750] flex items-center justify-center bg-slate-950/70 p-3"><section role="dialog" aria-modal="true" aria-label="พิมพ์บิลทั้งหมดตามตัวกรอง" onKeyDown={e=>{if(e.key==="Escape")setOpen(false);}} className="flex h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
 <header className="flex items-start justify-between border-b p-4"><div><h2 className="font-extrabold">พิมพ์บิลทั้งหมดตามตัวกรอง</h2><p className="text-xs text-slate-600">{count} บิล · ทุกหน้าตามตัวกรองที่ใช้แล้ว · ไม่สร้างธุรกรรมใหม่</p></div><button type="button" onClick={()=>setOpen(false)} className="rounded border px-3 py-2">ปิด (Esc)</button></header>
 <div className="flex flex-wrap items-center gap-2 border-b p-3">{(["58","80","a4","a5"] as const).map(p=><button key={p} type="button" aria-pressed={p===paper} onClick={()=>{if(p!==paper){setReady(false);setError("");setPaper(p);}}} className={"rounded border px-3 py-2 text-xs font-bold "+(paper===p?"bg-blue-700 text-white":"bg-white")}>{p==="58"||p==="80"?p+" มม.":p.toUpperCase()}</button>)}<span className="text-xs text-slate-500">เลือกขนาดกระดาษในไดรเวอร์ให้ตรงกัน</span></div>
 <iframe ref={frame} key={src} src={src} onLoad={loaded} title="ตัวอย่างบิลทั้งหมด" className="min-h-0 flex-1 bg-slate-100"/>
 <footer className="flex flex-wrap items-center justify-between gap-2 border-t p-3"><p role="status" className="text-xs text-slate-600">{error|| (ready?"เตรียมครบ "+count+" บิลแล้ว":"กำลังเตรียมบิลทั้งหมด...")}</p><button type="button" disabled={!ready} onClick={()=>void print()} className="rounded bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-40">พิมพ์ทั้งหมด / บันทึก PDF</button></footer>
 </section></div>}</>;
}
