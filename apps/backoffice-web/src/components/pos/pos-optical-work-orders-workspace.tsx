"use client";

import { useEffect, useState } from "react";
import { formatSalesMoney } from "@/lib/pos-money";

type Customer={id:string;customer_code:string;full_name:string};
type Seller={id:string;name:string};
type Inventory={product_id:string;sku:string;name:string;kind:string;brand:string|null;
  model:string|null;unit:string;unit_price:number;available:number};
type WorkOrder={id:string;customer_id:string;status:string;total_amount:number;
  paid_total:number;due_at:string|null};
type Api<T>={data?:T;error?:{message?:string}};

async function api<T>(url:string,init?:RequestInit):Promise<T>{
  const result=await fetch(url,{credentials:"same-origin",cache:"no-store",...init});
  const body=await result.json().catch(()=>null) as Api<T>|null;
  if(!result.ok||!body?.data)throw new Error(body?.error?.message??"ระบบ Optical ยังไม่พร้อมใช้งาน");
  return body.data;
}
const fmt=(v:number)=>formatSalesMoney(v,"LAK");
const makeId=()=>crypto.randomUUID();

export function PosOpticalWorkOrdersWorkspace(){
  const [customers,setCustomers]=useState<Customer[]>([]);
  const [sellers,setSellers]=useState<Seller[]>([]);
  const [items,setItems]=useState<Inventory[]>([]);
  const [customerId,setCustomerId]=useState("");
  const [sellerId,setSellerId]=useState("");
  const [sku,setSku]=useState("");
  const [selected,setSelected]=useState<Inventory|null>(null);
  const [qty,setQty]=useState(1);
  const [discount,setDiscount]=useState(0);
  const [dueAt,setDueAt]=useState("");
  const [order,setOrder]=useState<WorkOrder|null>(null);
  const [recallCode,setRecallCode]=useState("");
  const [deposit,setDeposit]=useState(0);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [requestId,setRequestId]=useState(makeId);
  const [paymentRequestId,setPaymentRequestId]=useState(makeId);
  const [transitionRequestId,setTransitionRequestId]=useState(makeId);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    let active=true;
    Promise.all([
      api<{customers:Customer[]}>("/api/pos/optical/customers"),
      api<{sellers:Seller[]}>("/api/pos/optical/sellers"),
      api<{items:Inventory[]}>("/api/pos/optical/inventory")
    ]).then(([a,b,c])=>{
      if(!active)return;
      setCustomers(a.customers);setSellers(b.sellers);setItems(c.items);
      if(b.sellers.length===1)setSellerId(b.sellers[0].id);
    }).catch(e=>{if(active)setError(String(e instanceof Error?e.message:e));})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);

  const submitSku=(code=sku)=>{
    const found=items.find(item=>item.sku.toLowerCase()===code.trim().toLowerCase());
    if(!found){setError("ไม่พบ SKU ในสต๊อก Optical ที่ผ่านการตรวจสอบ");return;}
    if(found.available<1){setError("สินค้าหมดหรือถูกจองครบแล้ว");return;}
    setSelected(found);setSku("");setQty(1);setError("");
  };

  // Barcode scanners can send an alphanumeric SKU without Enter.
  // Resolve only an exact stock-approved SKU after the input burst has settled,
  // without a per-keystroke network request. Ordinary restaurant scanning
  // remains owned by the existing POS adapter.
  useEffect(()=>{
    const code=sku.trim().toLowerCase();
    if(!code || !items.length)return;
    const timer=window.setTimeout(()=>{
      const hit=items.find(item=>item.sku.toLowerCase()===code);
      if(hit&&hit.available>0){
        setSelected(hit);setSku("");setQty(1);setError("");
      }
    },300);
    return()=>window.clearTimeout(timer);
  },[sku,items]);

  const create=async()=>{
    if(!customerId||!sellerId||!selected||qty<1||qty>selected.available||
      discount<0||!Number.isInteger(discount)||discount>=selected.unit_price*qty){
      setError("กรุณาเลือกลูกค้า พนักงานขาย สินค้า และตรวจจำนวน/ส่วนลด");return;
    }
    setBusy(true);setError("");setNotice("");
    try{
      const result=await api<{work_order_id:string;duplicate_request:boolean}>("/api/pos/optical/work-orders",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({request_id:requestId,customer_id:customerId,seller_id:sellerId,
          items:[{product_id:selected.product_id,quantity:qty}],discount_lak:discount,
          due_at:dueAt?new Date(dueAt+"T12:00:00+07:00").toISOString():null})
      });
      setOrder({id:result.work_order_id,customer_id:customerId,status:"received",
        total_amount:selected.unit_price*qty-discount,paid_total:0,due_at:dueAt||null});
      setNotice(result.duplicate_request?"เรียกคืนใบสั่งงานเดิมแล้ว":"สร้างใบสั่งงานและจองสต๊อกแล้ว");
      setRequestId(makeId());
    }catch(e){setError(String(e instanceof Error?e.message:e));}
    finally{setBusy(false);}
  };

  const recall=async()=>{
    setBusy(true);setError("");setNotice("");
    try{
      const result=await api<{bill:WorkOrder;remaining_amount:number}>(
        "/api/pos/optical/work-orders/recall?code="+encodeURIComponent(recallCode.trim()));
      setOrder(result.bill);setNotice("เรียกบิลมัดจำที่ยังมียอดค้างสำเร็จ");
    }catch(e){setError(String(e instanceof Error?e.message:e));}
    finally{setBusy(false);}
  };

  // Barcode/QR HID scanners may not send Enter. A complete bill locator
  // automatically triggers a read-only, authenticated tenant/branch lookup.
  useEffect(()=>{
    const value=recallCode.trim();
    if(!/^CPI-OPTICAL-RECALL:1:[0-9a-f-]{36}$/i.test(value))return;
    const ctrl=new AbortController();
    const timer=window.setTimeout(()=>{
      void api<{bill:WorkOrder;remaining_amount:number}>(
        "/api/pos/optical/work-orders/recall?code="+encodeURIComponent(value),
        {signal:ctrl.signal}
      ).then(result=>{
        if(!ctrl.signal.aborted){setOrder(result.bill);setNotice("โหลดบิลมัดจำที่ยังค้างชำระแล้ว");setError("");}
      }).catch(e=>{
        if(!ctrl.signal.aborted)setError(String(e instanceof Error?e.message:e));
      });
    },180);
    return()=>{window.clearTimeout(timer);ctrl.abort();};
  },[recallCode]);

  const pay=async()=>{
    if(!order||!Number.isSafeInteger(deposit)||deposit<=0||
      deposit>order.total_amount-order.paid_total){
      setError("ยอดมัดจำต้องมากกว่า 0 และไม่เกินยอดค้าง");return;
    }
    setBusy(true);setError("");setNotice("");
    try{
      const result=await api<{payment_id:string;paid_total:number;remaining_amount:number;duplicate_request:boolean}>(
        "/api/pos/optical/work-orders/"+encodeURIComponent(order.id)+"/payments",{
          method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({request_id:paymentRequestId,amount_lak:deposit,method:"cash"})
        });
      setOrder({...order,paid_total:result.paid_total});
      setDeposit(0);setPaymentRequestId(makeId());
      setNotice(result.duplicate_request?"ธุรกรรมเดิมถูกตรวจพบ ไม่รับเงินซ้ำ":
        "บันทึกรับเงินสดสำเร็จ ยอดค้าง "+fmt(result.remaining_amount));
    }catch(e){setError(String(e instanceof Error?e.message:e));}
    finally{setBusy(false);}
  };
  const receipt=()=>{
    if(!order)return;
    window.open("/api/pos/optical/work-orders/"+encodeURIComponent(order.id)+
      "/deposit-receipt","_blank","noopener,noreferrer");
  };
  const transition=async(next:string)=>{
    if(!order)return;
    setBusy(true);setError("");
    try{
      const result=await api<{status:string;duplicate_request:boolean}>(
        "/api/pos/optical/work-orders/"+encodeURIComponent(order.id)+"/transition",{
          method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({next_status:next,request_id:transitionRequestId})
        });
      setOrder({...order,status:result.status});setTransitionRequestId(makeId());
      setNotice(result.duplicate_request?"ดำเนินการคำสั่งนี้แล้ว":"อัปเดตสถานะใบสั่งงานแล้ว");
    }catch(e){setError(String(e instanceof Error?e.message:e));}
    finally{setBusy(false);}
  };

  return <main className="mx-auto max-w-5xl space-y-5 rounded-2xl bg-gradient-to-b from-emerald-50 to-white p-5">
    <header className="rounded-xl bg-emerald-100 p-4">
      <h1 className="text-2xl font-bold text-emerald-900">Optical · ใบสั่งงาน / รับมัดจำ</h1>
      <p className="text-sm text-emerald-800">สำหรับร้านที่ IT อนุมัติ CUSTOM Optical เท่านั้น · รับเงินกีบ LAK</p>
    </header>
    {loading?<p role="status">กำลังโหลดสิทธิ์และข้อมูลสินค้า...</p>:null}
    {error?<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}
    {notice?<p role="status" className="rounded-lg bg-emerald-100 p-3 text-sm text-emerald-900">{notice}</p>:null}
    <section className="grid gap-3 rounded-xl border border-emerald-200 bg-white p-4 md:grid-cols-2">
      <label className="text-sm">ลูกค้า
        <select className="mt-1 w-full rounded-lg border p-2" value={customerId} onChange={e=>setCustomerId(e.target.value)}>
          <option value="">เลือกลูกค้า</option>{customers.map(x=><option key={x.id} value={x.id}>{x.customer_code} · {x.full_name}</option>)}
        </select>
      </label>
      <label className="text-sm">พนักงานผู้ขาย
        <select className="mt-1 w-full rounded-lg border p-2" value={sellerId} onChange={e=>setSellerId(e.target.value)}>
          <option value="">เลือกพนักงาน</option>{sellers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </label>
      <label className="text-sm">ยิงบาร์โค้ด / SKU
        <input className="mt-1 w-full rounded-lg border p-2" value={sku} onChange={e=>setSku(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();submitSku();}}}
          placeholder="ยิง SKU เพื่อเพิ่มรายการอัตโนมัติ"/>
      </label>
      <label className="text-sm">วันที่นัดรับ
        <input type="date" className="mt-1 w-full rounded-lg border p-2" value={dueAt} onChange={e=>setDueAt(e.target.value)}/>
      </label>
      {selected?<div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 md:col-span-2">
        <strong>{selected.name}</strong> · {fmt(selected.unit_price)} / {selected.unit}
        <p className="text-xs">พร้อมขาย {selected.available} หน่วย</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label>จำนวน <input type="number" min={1} max={selected.available} value={qty} onChange={e=>setQty(Number(e.target.value))}
            className="ml-2 w-20 rounded border p-2"/></label>
          <label>ส่วนลด LAK <input type="number" min={0} step={1} value={discount} onChange={e=>setDiscount(Number(e.target.value))}
            className="ml-2 w-28 rounded border p-2"/></label>
        </div>
        <p className="mt-3 font-bold">ยอดเต็ม {fmt(selected.unit_price*qty-discount)}</p>
      </div>:null}
      <button type="button" disabled={busy||loading||!selected} onClick={()=>void create()}
        className="rounded-xl bg-emerald-700 p-3 font-bold text-white disabled:opacity-50 md:col-span-2">
        สร้างใบสั่งงานและจองสินค้า
      </button>
    </section>
    <section className="rounded-xl border border-emerald-200 bg-white p-4">
      <h2 className="font-bold">เรียกบิลมัดจำจาก QR / สแกนรหัส</h2>
      <div className="mt-2 flex gap-2">
        <input value={recallCode} onChange={e=>setRecallCode(e.target.value)} placeholder="ยิง QR ใบเสร็จเพื่อค้นหาบิลอัตโนมัติ"
          className="min-w-0 flex-1 rounded-lg border p-2"/>
        <button type="button" onClick={()=>void recall()} disabled={busy} className="rounded-lg bg-emerald-600 px-4 py-2 text-white">ค้นหา</button>
      </div>
    </section>
    {order?<section className="space-y-3 rounded-xl border border-emerald-200 bg-white p-4">
      <h2 className="font-bold">บิล {order.id.slice(0,8)} · {order.status}</h2>
      <p>ยอดเต็ม {fmt(Number(order.total_amount))} · รับแล้ว {fmt(Number(order.paid_total))}</p>
      <p className="text-xl font-bold text-emerald-800">ยอดค้าง {fmt(Number(order.total_amount)-Number(order.paid_total))}</p>
      {Number(order.total_amount)>Number(order.paid_total)&&order.status!=="cancelled"&&order.status!=="collected"?
        <div className="flex flex-wrap items-center gap-2">
          <label>รับเงินสดมัดจำ LAK <input type="number" step={1} min={1} value={deposit} onChange={e=>setDeposit(Number(e.target.value))}
            className="ml-2 w-32 rounded-lg border p-2"/></label>
          <button type="button" disabled={busy} onClick={()=>void pay()} className="rounded-lg bg-emerald-700 p-3 text-white">ยืนยันรับเงินสด</button>
        </div>:null}
      {Number(order.paid_total)>0&&Number(order.paid_total)<Number(order.total_amount)?
        <button type="button" onClick={receipt} className="rounded-lg border border-emerald-600 px-4 py-2 text-emerald-800">
          เปิดตัวอย่างใบเสร็จมัดจำ 80 มม. + QR
        </button>:null}
      <div className="flex flex-wrap gap-2">
        {([["received","lens_ordered","สั่งเลนส์"],["lens_ordered","edging","เจียร"],
          ["edging","ready_for_pickup","รอรับ"],["ready_for_pickup","collected","ส่งมอบสินค้า"]] as const)
          .filter(([current])=>order.status===current).map(([,next,label])=>
          <button type="button" key={next} disabled={busy||next==="collected"&&order.paid_total<order.total_amount}
            onClick={()=>void transition(next)} className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50">
            {label}</button>)}
      </div>
      <p className="text-xs text-slate-600">เงินโอนรอการเชื่อมตรวจหลักฐานโดยผู้จัดการก่อนเปิดใช้ · ไม่แก้ระบบชำระเงินร้านอาหาร</p>
    </section>:null}
  </main>;
}
