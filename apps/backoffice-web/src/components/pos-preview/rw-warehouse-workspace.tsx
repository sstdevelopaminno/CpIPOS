"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Warehouse = {id:string;code:string;name:string};
type Balance = {warehouse_id:string;sku:string;quantity:number;carrying_minor:number};
type Branch = {id:string;name:string};
type Line = {sku:string;quantity:number;received:number};
type Transfer = {id:string;warehouse_id:string;destination_branch_id:string;status:string;created_at:string;rw_warehouse_transfer_lines:Line[]};
type Data = {owner:boolean;warehouses:Warehouse[];balances:Balance[];branches:Branch[];transfers:Transfer[]};
type Command = "create_warehouse"|"register_sku"|"inbound"|"create_draft"|"approve_transfer"|"cancel_transfer"|"dispatch"|"receive";
const endpoint="/api/backoffice/rw-warehouse";
const ownerCommands:Command[]=["create_warehouse","register_sku","inbound","create_draft","approve_transfer","dispatch","cancel_transfer","receive"];
const labels:Record<Command,[string,string]>={
 create_warehouse:["สร้างคลังสินค้า","Create warehouse"],register_sku:["ลงทะเบียน SKU","Register SKU"],
 inbound:["รับสินค้าเข้าคลัง (ทดสอบ)","Inbound (test)"],create_draft:["สร้างใบโอน","Create transfer"],
 approve_transfer:["อนุมัติใบโอน","Approve transfer"],cancel_transfer:["ยกเลิกใบโอน","Cancel transfer"],
 dispatch:["จัดส่งสินค้า","Dispatch"],receive:["ตรวจรับสินค้า","Receive stock"]
};
const statuses:Record<string,[string,string]>={draft:["ร่าง","Draft"],approved:["อนุมัติแล้ว","Approved"],in_transit:["ระหว่างทาง","In transit"],partially_received:["รับบางส่วน","Partially received"],received:["รับครบ","Received"],cancelled:["ยกเลิก","Cancelled"]};
const field="min-h-10 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
export function RwWarehouseWorkspace({th}:{th:boolean}) {
 const tr=(a:string,b:string)=>th?a:b;
 const [data,setData]=useState<Data|null>(null);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [busy,setBusy]=useState(false);
 const submitting=useRef(false);
 const [action,setAction]=useState<Command>("receive");
 const [warehouse,setWarehouse]=useState("");
 const [branch,setBranch]=useState("");
 const [transfer,setTransfer]=useState("");
 const [sku,setSku]=useState("");
 const [quantity,setQuantity]=useState("1");
 const [total,setTotal]=useState("");
 const [source,setSource]=useState("");
 const [code,setCode]=useState("");
 const [name,setName]=useState("");
 const [pin,setPin]=useState("");
 const [lines,setLines]=useState<{sku:string;quantity:string}[]>([{sku:"",quantity:"1"}]);
 const lastRequest=useRef<{fingerprint:string;id:string}|null>(null);
 const refresh=useCallback(async()=>{
  const response=await fetch(endpoint,{cache:"no-store"});
  const result=await response.json();
  if(!response.ok||!result.data)throw new Error(result.error?.code??"WAREHOUSE_UNAVAILABLE");
  setData(result.data as Data);
 },[]);
 useEffect(()=>{void refresh().catch(e=>setError(e instanceof Error?e.message:"WAREHOUSE_UNAVAILABLE"));},[refresh]);
 const transferActions=["approve_transfer","cancel_transfer","dispatch","receive"];
 const needsTransfer=transferActions.includes(action);
 const needsWarehouse=["register_sku","inbound","create_draft"].includes(action);
 const eligible=(data?.transfers??[]).filter(t=> action==="approve_transfer"?t.status==="draft":action==="cancel_transfer"?["draft","approved"].includes(t.status):action==="dispatch"?t.status==="approved":["in_transit","partially_received"].includes(t.status));
 const chosen=eligible.find(t=>t.id===transfer);
 function setCommand(next:Command){setAction(next);setTransfer("");setSku("");setPin("");setNotice("");setError("");}
 async function submit(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();if(submitting.current)return;submitting.current=true;setBusy(true);setNotice("");setError("");
  try{
   let payload:Record<string,unknown>={action};
   if(action==="create_warehouse")payload={...payload,code,name};
   if(needsWarehouse)payload.warehouseId=warehouse;
   if(action==="register_sku"||action==="inbound"||action==="receive")payload.sku=sku;
   if(action==="inbound")payload={...payload,quantity:Number(quantity),totalMinor:Number(total),sourceDocument:source};
   if(action==="create_draft")payload={...payload,branchId:branch,lines:lines.map(l=>({sku:l.sku,quantity:Number(l.quantity)}))};
   if(needsTransfer)payload.transferId=transfer;
   if(action==="receive")payload.quantity=Number(quantity);
   const fingerprint=JSON.stringify(payload);
   if(lastRequest.current?.fingerprint!==fingerprint)lastRequest.current={fingerprint,id:crypto.randomUUID()};
   if(action==="approve_transfer"||action==="cancel_transfer")payload.pin=pin;
   const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,requestId:lastRequest.current.id})});
   const result=await response.json();
   if(!response.ok||result.error)throw new Error(result.error?.code??"WAREHOUSE_UNAVAILABLE");
   lastRequest.current=null;
   setNotice(tr("บันทึกรายการสำเร็จ","Command recorded"));
   await refresh().catch(()=>setError(tr("บันทึกแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ","Saved, but refresh failed")));
  }catch(e){setError(e instanceof Error?e.message:"WAREHOUSE_UNAVAILABLE");}finally{setPin("");setBusy(false);submitting.current=false;}
 }
 return <section className="flex min-h-0 flex-1 flex-col gap-4 p-4" data-testid="rw-warehouse-uat">
  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
   <div><h3 className="text-lg font-extrabold text-slate-900">{tr("คลังสินค้าและใบโอน","Warehouse & transfers")}</h3><p className="text-sm text-amber-700">{tr("UAT เท่านั้น · ห้ามใช้ข้อมูลลูกค้าจริง · ยังไม่โพสต์ GL","UAT only · synthetic data only · GL posting disabled")}</p></div>
   <button type="button" className={field} disabled={busy} onClick={()=>void refresh().catch(e=>setError(e instanceof Error?e.message:"WAREHOUSE_UNAVAILABLE"))}>{tr("รีเฟรช","Refresh")}</button>
  </div>
  {error&&<p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {notice&&<p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
  {!data&&!error&&<p className="text-sm text-slate-500">{tr("กำลังโหลดข้อมูล","Loading")}</p>}
  {data&&<>
   {data.owner&&<div className="overflow-x-auto rounded-md border border-slate-200">
    <table className="w-full min-w-[560px] text-left text-sm"><thead className="bg-slate-100 text-slate-700"><tr>{[tr("คลัง","Warehouse"),"SKU",tr("คงเหลือ","On hand"),tr("มูลค่า (หน่วยย่อย)","Value (minor units)")].map(h=><th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
    <tbody>{data.balances.map(row=><tr key={row.warehouse_id+":"+row.sku} className="border-t border-slate-200"><td className="px-3 py-2">{data.warehouses.find(w=>w.id===row.warehouse_id)?.name??row.warehouse_id}</td><td className="px-3 py-2">{row.sku}</td><td className="px-3 py-2 tabular-nums">{row.quantity}</td><td className="px-3 py-2 tabular-nums">{row.carrying_minor}</td></tr>)}</tbody></table>
    {!data.balances.length&&<p className="p-3 text-sm text-slate-500">{tr("ไม่พบรายการคลัง","No warehouse stock records")}</p>}
   </div>}
   <form onSubmit={submit} className="grid gap-3 rounded-md border border-slate-200 p-4 text-sm">
    <fieldset disabled={busy} className="grid gap-3">
    <label className="grid gap-1">{tr("ทำรายการ","Action")}<select className={field} value={action} onChange={e=>setCommand(e.target.value as Command)}>{(data.owner?ownerCommands:["receive"] as Command[]).map(c=><option key={c} value={c}>{labels[c][th?0:1]}</option>)}</select></label>
    {action==="create_warehouse"&&<div className="grid gap-2 sm:grid-cols-2"><label>{tr("รหัสคลัง","Code")}<input className={field+" w-full"} required maxLength={40} value={code} onChange={e=>setCode(e.target.value)}/></label><label>{tr("ชื่อคลัง","Name")}<input className={field+" w-full"} required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label></div>}
    {needsWarehouse&&<label className="grid gap-1">{tr("คลังสินค้า","Warehouse")}<select className={field} required value={warehouse} onChange={e=>{setWarehouse(e.target.value);setSku("");}}><option value="">{tr("เลือกคลัง","Select warehouse")}</option>{data.warehouses.map(w=><option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}</select></label>}
    {needsTransfer&&<label className="grid gap-1">{tr("ใบโอนสินค้า","Transfer")}<select className={field} required value={transfer} onChange={e=>{setTransfer(e.target.value);setSku("");}}><option value="">{tr("เลือกใบโอน","Select transfer")}</option>{eligible.map(t=><option key={t.id} value={t.id}>{t.id.slice(0,8)} — {statuses[t.status]?.[th?0:1]??t.status}</option>)}</select></label>}
    {action==="register_sku"&&<label className="grid gap-1">SKU<input required className={field} maxLength={40} value={sku} onChange={e=>setSku(e.target.value)}/></label>}
    {(action==="inbound"||action==="receive")&&<div className="grid gap-2 sm:grid-cols-2"><label className="grid gap-1">SKU<select className={field} required value={sku} onChange={e=>setSku(e.target.value)}><option value="">—</option>{(action==="inbound"?data.balances.filter(b=>b.warehouse_id===warehouse):chosen?.rw_warehouse_transfer_lines.filter(l=>l.quantity>l.received)??[]).map(l=><option key={l.sku} value={l.sku}>{l.sku}</option>)}</select></label><label className="grid gap-1">{tr("จำนวน","Quantity")}<input type="number" required min="1" step="1" className={field} value={quantity} onChange={e=>setQuantity(e.target.value)}/></label></div>}
    {action==="inbound"&&<div className="grid gap-2 sm:grid-cols-2"><label className="grid gap-1">{tr("ต้นทุนรวม (หน่วยย่อย)","Total cost (minor units)")}<input type="number" required min="0" step="1" className={field} value={total} onChange={e=>setTotal(e.target.value)}/></label><label className="grid gap-1">{tr("เอกสารจำลอง","Synthetic document")}<input required className={field} maxLength={120} value={source} onChange={e=>setSource(e.target.value)}/></label></div>}
    {action==="create_draft"&&<><label className="grid gap-1">{tr("สาขาปลายทาง","Destination branch")}<select className={field} required value={branch} onChange={e=>setBranch(e.target.value)}><option value="">—</option>{data.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>{lines.map((l,index)=><div key={index} className="grid grid-cols-[1fr_100px_auto] gap-2"><select required aria-label="SKU" className={field} value={l.sku} onChange={e=>setLines(prev=>prev.map((row,i)=>i===index?{...row,sku:e.target.value}:row))}><option value="">SKU</option>{data.balances.filter(b=>b.warehouse_id===warehouse).map(b=><option key={b.sku} value={b.sku}>{b.sku}</option>)}</select><input aria-label={tr("จำนวน","Quantity")} className={field} type="number" required min="1" step="1" value={l.quantity} onChange={e=>setLines(prev=>prev.map((row,i)=>i===index?{...row,quantity:e.target.value}:row))}/><button className={field} type="button" disabled={lines.length<=1} onClick={()=>setLines(prev=>prev.filter((_,i)=>i!==index))}>−</button></div>)}<button type="button" className={field} disabled={lines.length>=100} onClick={()=>setLines(prev=>[...prev,{sku:"",quantity:"1"}])}>{tr("+ เพิ่มรายการ","+ Add line")}</button></>}
    {(action==="approve_transfer"||action==="cancel_transfer")&&<label className="grid gap-1">{tr("PIN เจ้าของร้าน","Owner PIN")}<input className={field} type="password" autoComplete="off" required value={pin} onChange={e=>setPin(e.target.value)} maxLength={64}/></label>}
    <button type="submit" className="min-h-10 rounded-md bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">{busy?tr("กำลังบันทึก","Saving"):tr("ยืนยันรายการ","Confirm command")}</button>
    </fieldset>
   </form>
   <div className="overflow-x-auto rounded-md border border-slate-200"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-slate-100"><tr>{[tr("ใบโอน","Transfer"),tr("ปลายทาง","Destination"),tr("สถานะ","Status"),tr("รายการ / ตรวจรับ","Lines / received")].map(h=><th key={h} className="px-3 py-2">{h}</th>)}</tr></thead><tbody>{data.transfers.map(t=><tr key={t.id} className="border-t border-slate-200"><td className="px-3 py-2 font-semibold">{t.id.slice(0,8)}</td><td className="px-3 py-2">{data.branches.find(b=>b.id===t.destination_branch_id)?.name??t.destination_branch_id.slice(0,8)}</td><td className="px-3 py-2">{statuses[t.status]?.[th?0:1]??t.status}</td><td className="px-3 py-2">{t.rw_warehouse_transfer_lines.map(l=><div key={l.sku}>{l.sku} · {l.received}/{l.quantity}</div>)}</td></tr>)}</tbody></table>{!data.transfers.length&&<p className="p-3 text-sm text-slate-500">{tr("ไม่มีใบโอน","No transfers")}</p>}</div>
  </>}
 </section>;
}
