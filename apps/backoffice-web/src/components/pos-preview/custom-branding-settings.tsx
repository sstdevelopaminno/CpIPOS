"use client";
import {useEffect,useState} from "react";

type Branding={system_name:string;accent_color:string;sidebar_color:string;logo_url:string|null};
const defaults:Branding={system_name:"CpiPOS",accent_color:"#1453A6",sidebar_color:"#071B37",logo_url:null};
const colors=["#1453A6","#047857","#7C3AED","#DB2777","#EA580C","#0F766E","#DC2626","#0F172A"];
const field="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm";
export function CustomBrandingSettings({onBack}:{onBack:()=>void}){
 const [data,setData]=useState<Branding>(defaults);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState("");
 useEffect(()=>{let alive=true;
  void fetch("/api/pos/settings/custom-branding",{cache:"no-store"})
   .then(r=>r.json()).then(x=>{if(!alive)return;
     if(!x.data?.enabled)throw new Error("เฉพาะแพ็กเกจ CUSTOM");
     setData(x.data.branding as Branding);
   }).catch(e=>{if(alive)setError(e instanceof Error?e.message:"โหลดธีมไม่สำเร็จ");})
    .finally(()=>{if(alive)setLoading(false);});
  return()=>{alive=false};
 },[]);
 async function upload(file:File|null){
  if(!file)return;
  setError("");setSaved("");
  if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>1048576){
    setError("รองรับภาพ PNG JPG WebP ไม่เกิน 1 MB");return;
  }
  setBusy(true);
  try{
   const form=new FormData();form.set("logo",file);
   const result=await fetch("/api/pos/settings/custom-branding/logo",{method:"POST",body:form,credentials:"same-origin"});
   const body=await result.json();
   if(!result.ok)throw new Error(body.error?.message??"อัปโหลดไม่สำเร็จ");
   setData(v=>({...v,logo_url:body.data.logo_url}));
  }catch(e){setError(e instanceof Error?e.message:"อัปโหลดไม่สำเร็จ");}
  finally{setBusy(false);}
 }
 async function save(){
  setBusy(true);setError("");setSaved("");
  try{
   const response=await fetch("/api/pos/settings/custom-branding",{
    method:"PATCH",headers:{"Content-Type":"application/json"},
    credentials:"same-origin",body:JSON.stringify(data)});
   const body=await response.json();
   if(!response.ok)throw new Error(body.error?.message??"บันทึกไม่สำเร็จ");
   setSaved("บันทึกธีมแล้ว ทั้ง POS และ CRM จะใช้ค่าชุดเดียวกัน");
   window.dispatchEvent(new Event("cpipos-custom-branding-updated"));
  }catch(e){setError(e instanceof Error?e.message:"บันทึกไม่สำเร็จ");}
  finally{setBusy(false);}
 }
 return <div className="space-y-5">
  <button onClick={onBack} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">← กลับเมนูตั้งค่า</button>
  <div><h2 className="text-xl font-extrabold text-slate-900">เปลี่ยนธีมสี โลโก้ และชื่อระบบ</h2>
   <p className="text-sm text-slate-500">เฉพาะ CUSTOM · ภายใต้แบรนด์ผู้ผลิต CpiPOS</p></div>
  {loading?<p role="status">กำลังโหลด...</p>:null}
  {!loading?<div className="grid gap-5 lg:grid-cols-2">
   <div className="space-y-4 rounded-xl border border-slate-200 p-4">
    <label className="block text-sm font-semibold">ชื่อระบบที่ลูกค้าเห็น
     <input className={field+" mt-1"} maxLength={55} minLength={2} value={data.system_name}
      onChange={e=>setData(v=>({...v,system_name:e.target.value}))}/></label>
    <label className="block text-sm font-semibold">โลโก้ร้าน
      <input className={field+" mt-1"} type="file" accept="image/png,image/jpeg,image/webp"
        disabled={busy} onChange={e=>void upload(e.currentTarget.files?.[0]??null)}/></label>
    {data.logo_url?<div className="flex items-center gap-3">
     <img src={data.logo_url} className="h-16 w-16 rounded-lg border object-contain" alt="โลโก้ร้าน"/>
     <button className="text-sm text-rose-700 underline" type="button" onClick={()=>setData(v=>({...v,logo_url:null}))}>ไม่ใช้โลโก้นี้</button>
    </div>:null}
    <p className="text-sm font-bold">สีไฮไลต์</p>
    <div className="flex flex-wrap gap-2">{colors.map(color=><button key={color}
      type="button" aria-label={"เลือกสี "+color}
      aria-pressed={data.accent_color.toUpperCase()===color}
      className="h-10 w-10 rounded-xl border-2 border-white ring-offset-2 aria-pressed:ring-2 aria-pressed:ring-slate-900"
      style={{backgroundColor:color}} onClick={()=>setData(v=>({...v,accent_color:color}))}/>)}</div>
    <div className="flex gap-3">
     <label className="text-sm">สีหลัก <input type="color" value={data.accent_color} onChange={e=>setData(v=>({...v,accent_color:e.target.value}))}/></label>
     <label className="text-sm">สีพื้นหลังเมนู <input type="color" value={data.sidebar_color} onChange={e=>setData(v=>({...v,sidebar_color:e.target.value}))}/></label>
    </div>
    <button disabled={busy||loading} className="rounded-xl px-5 py-3 font-bold text-white disabled:opacity-50"
      style={{backgroundColor:data.accent_color}} onClick={()=>void save()}>{busy?"กำลังบันทึก...":"บันทึกธีม"}</button>
    {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}
    {saved?<p role="status" className="text-sm text-emerald-700">{saved}</p>:null}
   </div>
   <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
    <div style={{backgroundColor:data.sidebar_color}} className="space-y-5 p-5 text-white">
     <div className="flex items-center gap-3">{data.logo_url?<img src={data.logo_url} alt="" className="h-14 w-14 rounded-xl bg-white object-contain"/>:null}
      <div><h3 className="font-extrabold">{data.system_name||"ชื่อระบบ"}</h3>
       <p className="text-xs text-slate-200">Powered by CpiPOS</p></div></div>
     <p className="rounded-xl p-3 font-bold" style={{backgroundColor:data.accent_color}}>หน้าขาย · เมนูที่เลือก</p>
     <p className="rounded-xl border border-white/30 p-3">รายการขาย</p><p className="rounded-xl border border-white/30 p-3">ตั้งค่า</p>
    </div>
    <p className="p-4 text-xs text-slate-500">ตัวอย่างสีเท่านั้น ไม่เปลี่ยนโลโก้หรือชื่อผู้ผลิต CpiPOS</p>
   </div>
  </div>:null}
 </div>;
}