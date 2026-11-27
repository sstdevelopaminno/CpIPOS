"use client";
import {useEffect,useState} from "react";
type Setting={enabled:boolean;ready:boolean};
export function RecyclingCashierDateSettings({onBack}:{onBack:()=>void}){
 const [setting,setSetting]=useState<Setting|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const url="/api/pos/settings/recycling-document-time";
 useEffect(()=>{const abort=new AbortController();void fetch(url,{cache:"no-store",signal:abort.signal}).then(async r=>{const body=await r.json();if(!r.ok)throw Error(body.error?.message||"โหลดการตั้งค่าไม่สำเร็จ");if(!abort.signal.aborted)setSetting(body.data);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[]);
 async function save(enabled:boolean){if(busy)return;setBusy(true);setError("");try{const r=await fetch(url,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled})});const body=await r.json();if(!r.ok)throw Error(body.error?.message||"บันทึกไม่สำเร็จ");setSetting(body.data);}catch(e){setError(e instanceof Error?e.message:"บันทึกไม่สำเร็จ");}finally{setBusy(false);}}
 return <section className="max-w-2xl space-y-4">
 <button type="button" onClick={onBack} className="rounded-lg border px-3 py-2 text-sm">← กลับ</button>
 <h2 className="text-xl font-bold">ตั้งค่าวันเวลาเอกสาร · CUSTOM Recycling</h2>
 <p className="text-sm text-slate-600">เปิดปุ่มเปลี่ยนวันเวลาเอกสารชั่วคราวในหน้าแคชเชียร์รับซื้อ–ขายออก เฉพาะสาขานี้ สำหรับเจ้าของร้านและผู้จัดการที่มีสิทธิ์</p>
 {setting?<label className="flex items-center justify-between gap-4 rounded-xl border p-4"><span><strong className="block">เปลี่ยนวันเวลาเอกสารชั่วคราว</strong><small className="text-slate-500">ค่าเริ่มต้นปิด · มีผลเฉพาะบิลที่กำลังทำ ไม่เปลี่ยนเวลาเครื่องหรือกะ</small></span><input type="checkbox" role="switch" checked={setting.enabled} disabled={busy||(!setting.ready&&!setting.enabled)} onChange={e=>void save(e.target.checked)} className="h-5 w-5"/></label>:!error?<p role="status">กำลังโหลด...</p>:null}
 {setting&&!setting.ready?<p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">ระบบยังไม่พร้อมเปิดใช้งาน ต้องผ่านการตรวจสอบฐานข้อมูลก่อน</p>:null}
 {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}
 <p className="text-xs text-slate-500">ใช้เฉพาะวันเวลาที่เกิดธุรกรรมจริง ไม่อนุญาตวันที่อนาคต งวดบัญชีที่ปิดแล้ว หรือการเปลี่ยนบิล VAT/GL ที่ต้องใช้เอกสารปรับปรุง</p>
 </section>;
}
