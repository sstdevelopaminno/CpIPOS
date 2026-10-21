"use client";

import {useEffect,useMemo,useState} from "react";
import {ProductMediaManager} from "@/components/pos-preview/product-media-manager";
import {formatSalesMoney,type SalesCurrencyCode} from "@/lib/pos-money";
import {PosBackButton} from "@/components/pos-preview/pos-back-button";
import {opticalStockText,opticalStockError} from "@/lib/optical-stock-i18n";
import type {Language} from "@/lib/i18n";

export type OpticalRow={
  id:string;name:string;sku:string|null;category:string|null;price:number;is_active:boolean;
  sell_unit:string|null;metadata:Record<string,unknown>|null;
  available:number|null;recipeAttached:boolean;
  opticalBin?:{product_id:string;kind:string;brand:string|null;model:string|null;
    color:string|null;frame_size:string|null;lens_type:string|null;lens_index:string|null;
    lens_sph:number|null;lens_cyl:number|null;on_hand:number;reserved:number;unit_price:number;currency_code:string}|null
};
type Kind="frame"|"lens"|"accessory";
type Draft={name:string;sku:string;kind:Kind;price:string;unit:string;note:string;
  brand:string;model:string;color:string;frame_size:string;lens_name:string;
  lens_index:string;lens_sph:string;lens_cyl:string;lens_axis:string;initial_quantity?:string};
type Modal=null|"add"|"bulk"|"edit"|"delete"|"sku"|"media"|"best"|"adjust"|"scan"|"summary";
const types:Record<Kind,string>={frame:"กรอบแว่น",lens:"เลนส์",accessory:"อุปกรณ์เสริม"};
const blank=():Draft=>({name:"",sku:"",kind:"frame",price:"",unit:"ชิ้น",note:"",
  brand:"",model:"",color:"",frame_size:"",lens_name:"",lens_index:"",lens_sph:"",lens_cyl:"",lens_axis:"",initial_quantity:""});
const field="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";
const btn="min-h-10 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40";
const kind=(row:OpticalRow):Kind=>{
  const k=row.metadata?.optical_kind;
  if(k==="frame"||k==="lens"||k==="accessory")return k;
  if(/เลนส์|lens/i.test(row.category??""))return "lens";
  if(/อุปกรณ์|accessory/i.test(row.category??""))return "accessory";
  return "frame";
};
const forEdit=(r:OpticalRow):Draft=>({name:r.name,sku:r.sku??"",kind:kind(r),
  price:String(r.opticalBin?.unit_price??r.price),unit:r.sell_unit??"ชิ้น",note:String(r.metadata?.optical_note??""),
  brand:String(r.opticalBin?.brand??r.metadata?.optical_brand??""),
  model:String(r.opticalBin?.model??r.metadata?.optical_model??""),
  color:String(r.opticalBin?.color??r.metadata?.optical_color??""),
  frame_size:String(r.opticalBin?.frame_size??r.metadata?.optical_frame_size??""),
  lens_name:String(r.opticalBin?.model??r.metadata?.optical_lens_name??r.name),
  lens_index:String(r.opticalBin?.lens_index??r.metadata?.optical_lens_index??""),
  lens_sph:String(r.opticalBin?.lens_sph??r.metadata?.optical_lens_sph??""),
  lens_cyl:String(r.opticalBin?.lens_cyl??r.metadata?.optical_lens_cyl??""),
  lens_axis:String(r.metadata?.optical_lens_axis??"")});
function detail(r:OpticalRow,key:"brand"|"model"|"color"|"frame_size"|"lens_index"|"lens_sph"|"lens_cyl"|"lens_type"|"lens_name") {
  const raw=key==="lens_name"?r.opticalBin?.model??r.metadata?.optical_lens_name??r.name:
    r.opticalBin?.[key]??r.metadata?.["optical_"+key];
  return raw===null||raw===undefined||String(raw).trim()===""?"—":String(raw);
}
const initialCount=(r:OpticalRow)=>r.opticalBin?.on_hand??r.available;
const remaining=(r:OpticalRow)=>r.opticalBin
  ?Math.max(0,Number(r.opticalBin.on_hand)-Number(r.opticalBin.reserved)):null;

function checkRows(rows:Draft[],currency:SalesCurrencyCode){
  const keys=new Set<string>();
  for(let i=0;i<rows.length;i++){
    const r=rows[i],sku=r.sku.trim().toLowerCase(),price=Number(r.price);
    if(!r.name.trim()||!sku)return "กรุณากรอกชื่อและ SKU / บาร์โค้ด ในแถว "+(i+1);
    if(!/^[^\s,;()]{1,90}$/.test(sku))return "รูปแบบ SKU / บาร์โค้ดไม่ถูกต้อง ในแถว "+(i+1);
    if(keys.has(sku))return "SKU / บาร์โค้ดซ้ำ ในแถว "+(i+1);
    keys.add(sku);
    // This is a proposal for a separately confirmed audited receipt, NOT catalog stock.
    const initial=r.initial_quantity?.trim()??"";
    if(initial && (!/^[1-9][0-9]*$/.test(initial) || Number(initial)>100000))
      return "จำนวนรับเข้าเริ่มต้นต้องเป็นจำนวนเต็มบวก 1–100000 ในแถว "+(i+1)+" (เว้นว่างหากยังไม่รับสต๊อก)";
    if(!r.price.trim()||!Number.isFinite(price)||price<0||
      (currency==="LAK"&&!Number.isInteger(price))||Math.round(price*100)/100!==price)
      return "ราคาสินค้าไม่ถูกต้อง ในแถว "+(i+1);
  }
  return "";
}
export function OpticalStockWorkspace({rows,branch,branchId,branches,currency,canManage,lang,showInactive}:{
  rows:OpticalRow[];branch:string;branchId:string;branches:{id:string;name:string}[];currency:SalesCurrencyCode;canManage:boolean;lang:Language;showInactive:boolean
}){
  const T=(thai:string)=>opticalStockText(lang,thai);
  const [search,setSearch]=useState(""),[filter,setFilter]=useState("all"),[stock,setStock]=useState("all");
  const [tab,setTab]=useState<Kind>("frame");
  const [page,setPage]=useState(1),[pageSize,setPageSize]=useState(10);
  const [modal,setModal]=useState<Modal>(null),[selected,setSelected]=useState<OpticalRow|null>(null);
  const [draft,setDraft]=useState<Draft>(blank()),[bulk,setBulk]=useState<Draft[]>([blank(),blank(),blank()]);
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [images,setImages]=useState<Record<string,{thumbnail_url:string}>>({});
  const [targetBranchId,setTargetBranchId]=useState(branchId);
  const [bestLoading,setBestLoading]=useState(false),[bestError,setBestError]=useState("");
  const [bestRows,setBestRows]=useState<{product_id:string;name:string;sku:string|null;units:number;revenue:number}[]>([]);
  const [sampled,setSampled]=useState(false);
  const [scanSku,setScanSku]=useState("");
  const [adjustFieldError,setAdjustFieldError]=useState<"sku"|"quantity"|"note"|null>(null);
  const [adjustSku,setAdjustSku]=useState("");
  const [adjustDirection,setAdjustDirection]=useState<"receive"|"issue">("receive");
  const [adjustQuantity,setAdjustQuantity]=useState("");
  const [adjustNote,setAdjustNote]=useState("");
  const [adjustRequestId,setAdjustRequestId]=useState("");
  const [adjustBranchId,setAdjustBranchId]=useState(branchId);
  const [newProductCreated,setNewProductCreated]=useState(false);
  const [initialReceiveQuantity,setInitialReceiveQuantity]=useState("");
  const [pendingBulkReceipts,setPendingBulkReceipts]=useState<{sku:string;quantity:string;branchId:string}[]>([]);
  const [bulkReceiptTotal,setBulkReceiptTotal]=useState(0);
  const displayed=useMemo(()=>rows.filter(r=>{
    if(search&&!([r.name,r.sku,r.category].some(v=>String(v??"").toLowerCase().includes(search.trim().toLowerCase()))))return false;
    if(kind(r)!==tab)return false;
    if(filter!=="all"&&kind(r)!==filter)return false;
    if(stock==="low"&&(r.opticalBin?.on_hand??r.available)!==1)return false;
    if(stock==="out"&&(r.opticalBin?.on_hand??r.available)!==0)return false;
    if(stock==="unverified"&&r.opticalBin)return false;
    if(stock==="available"&&!(r.opticalBin&&remaining(r)!==null&&remaining(r)!>0))return false;
    return true;
  }),[rows,search,filter,stock,tab]);
  const totalPages=Math.max(1,Math.ceil(displayed.length/pageSize)),currentPage=Math.min(page,totalPages);
  const subset=displayed.slice((currentPage-1)*pageSize,currentPage*pageSize);
  const visibleIds=subset.map(item=>item.id).join(",");
  useEffect(()=>{
    if(!visibleIds)return;
    const controller=new AbortController();
    void fetch("/api/pos/product-media?branch_id="+encodeURIComponent(branchId)+"&product_ids="+encodeURIComponent(visibleIds),
      {signal:controller.signal,cache:"no-store"}).then(r=>r.json()).then(body=>{
        if(!controller.signal.aborted&&body.data?.images)setImages(body.data.images);
      }).catch(()=>{});
    return()=>controller.abort();
  },[visibleIds,modal,branchId]);
  useEffect(()=>{
    if(modal!=="best")return;
    const controller=new AbortController();
    setBestLoading(true);setBestError("");setBestRows([]);
    void fetch("/api/pos/optical/best-sellers?branch_id="+encodeURIComponent(branchId),
      {signal:controller.signal,cache:"no-store"}).then(async response=>{
        const body=await response.json();
        if(!response.ok)throw new Error(body.error?.message??"โหลดสินค้าขายดีไม่สำเร็จ");
        if(!controller.signal.aborted){
          setBestRows(body.data?.ranked??[]);setSampled(Boolean(body.data?.sampled));
        }
      }).catch(e=>{if(!controller.signal.aborted)setBestError(opticalStockError(lang,e instanceof Error?e.message:"โหลดไม่สำเร็จ"));})
      .finally(()=>{if(!controller.signal.aborted)setBestLoading(false);});
    return()=>controller.abort();
  },[modal,branchId]);
  const change=(key:keyof Draft,value:string)=>setDraft(s=>({...s,[key]:value}));
  const changeBulk=(idx:number,key:keyof Draft,value:string)=>
    setBulk(s=>s.map((r,i)=>i===idx?{...r,[key]:value}:r));
  const show=(m:Modal,r?:OpticalRow)=>{
    setError("");setAdjustFieldError(null);setSelected(r??null);setModal(m);
    if(m==="scan")setScanSku("");
    if(m==="add"){setDraft({...blank(),kind:tab});setInitialReceiveQuantity("");setNewProductCreated(false);}
    if(m==="add"||m==="bulk")setTargetBranchId(branchId);
    if(m==="edit"&&r)setDraft(forEdit(r));
    if(m==="bulk"){
      setNewProductCreated(false);setPendingBulkReceipts([]);setBulkReceiptTotal(0);
      setBulk([blank(),blank(),blank()].map(row=>({...row,kind:tab})));
    }
  };
  function openStockAdjustment(sku: string, stockBranchId=branchId) {
    if (!canManage) return;
    setAdjustSku(sku.trim());setAdjustBranchId(stockBranchId);
    setAdjustDirection("receive");setAdjustQuantity("");
    setAdjustNote("");setAdjustRequestId(crypto.randomUUID());setError("");setAdjustFieldError(null);
    setModal("adjust");
  }
  function handleBarcodeScan() {
    const barcode=scanSku.trim().toLowerCase();
    if (!barcode){setError(T("กรุณากรอกหรือยิงบาร์โค้ดสินค้า"));return;}
    const match=rows.find(row=>row.sku?.toLowerCase()===barcode);
    if (!match) {setError(T("ไม่พบ SKU / บาร์โค้ดในสาขานี้"));return;}
    setScanSku("");openStockAdjustment(match.sku??barcode);
  }
  function advanceReceiptQueue() {
    if(pendingBulkReceipts.length){
      const [next,...rest]=pendingBulkReceipts;
      setPendingBulkReceipts(rest);
      openStockAdjustment(next.sku,next.branchId);
      setAdjustQuantity(next.quantity);
      return;
    }
    window.location.assign("/preview/pos/stock/custom?branch_id="+encodeURIComponent(adjustBranchId));
  }
  async function saveStockAdjustment() {
    if (!canManage || busy) return;
    const amount=Number(adjustQuantity);
    if(!/^[^\s,;()]{1,90}$/.test(adjustSku.trim())){
      setAdjustFieldError("sku");setError(T("กรุณาระบุ SKU / บาร์โค้ดสินค้าที่ถูกต้อง"));return;
    }
    if (!/^[1-9][0-9]*$/.test(adjustQuantity.trim()) ||
        !Number.isSafeInteger(amount) || amount>100000) {
      setAdjustFieldError("quantity");setError(T("จำนวนต้องเป็นจำนวนเต็มบวกตั้งแต่ 1 ถึง 100,000 ชิ้น"));return;
    }
    if (!adjustNote.trim()) {
      setAdjustFieldError("note");setError(T("กรุณาระบุเหตุผลในการปรับสต๊อก"));return;
    }
    if(adjustNote.trim().length<3) {
      setAdjustFieldError("note");setError(T("เหตุผลในการปรับสต๊อกต้องมีอย่างน้อย 3 ตัวอักษร"));return;
    }
    if(adjustNote.trim().length>300){
      setAdjustFieldError("note");setError(T("เหตุผลในการปรับสต๊อกต้องไม่เกิน 300 ตัวอักษร"));return;
    }
    setBusy(true);setError("");setAdjustFieldError(null);
    try {
      const res=await fetch("/api/pos/optical/stock/adjust",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({branch_id:adjustBranchId,sku:adjustSku,quantity:amount,
          direction:adjustDirection,note:adjustNote.trim(),request_id:adjustRequestId})
      });
      const json=await res.json().catch(()=>null) as {error?:{message?:string}}|null;
      if (!res.ok) throw new Error(json?.error?.message??"บันทึกรายการปรับสต๊อกไม่สำเร็จ");
      if(newProductCreated){
        setBusy(false);
        advanceReceiptQueue();
      }else{
        window.location.assign("/preview/pos/stock/custom?branch_id="+encodeURIComponent(adjustBranchId));
      }
    } catch(e) {
      // Keep the request UUID stable for retries to prevent duplicated stock entries.
      setError(opticalStockError(lang,e instanceof Error?e.message:"บันทึกไม่สำเร็จ"));
      setBusy(false);
    }
  }
  const close=()=>{if(!busy){
    // Cancel only skips this proposed receipt. It never rolls back the created catalog item.
    if(newProductCreated){advanceReceiptQueue();return;}
    setModal(null);setError("");
  }};
  async function changeSaleVisibility(item:OpticalRow,action:"archive"|"restore"){
    if(!canManage||busy)return;
    if(!window.confirm(T(action==="archive"?
      "หยุดจำหน่ายสินค้านี้ โดยคงประวัติสต๊อกและใบสั่งงานไว้?":"เปิดจำหน่ายสินค้านี้อีกครั้ง?")))return;
    setBusy(true);setError("");
    try{
      const res=await fetch("/api/pos/optical/catalog",{
        method:"PUT",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:item.id,branch_id:branchId,action}),cache:"no-store"
      });
      const result=await res.json().catch(()=>null) as {error?:{message?:string}}|null;
      if(!res.ok)throw new Error(result?.error?.message??T("เปลี่ยนสถานะสินค้าไม่สำเร็จ"));
      window.location.assign("/preview/pos/stock/custom?branch_id="+encodeURIComponent(branchId)
        +(showInactive?"&show_inactive=1":""));
    }catch(e){setError(opticalStockError(lang,e instanceof Error?e.message:"เปลี่ยนสถานะสินค้าไม่สำเร็จ"));setBusy(false);}
  }
  async function save(){
    if(!modal||busy)return;
    if(modal==="sku"||modal==="media"||modal==="best"||modal==="adjust"||modal==="scan"||modal==="summary")return;
    const items=modal==="bulk"?bulk:[draft];
    if(modal!=="delete"){
      if(modal==="add" && initialReceiveQuantity.trim() &&
        (!/^[1-9][0-9]*$/.test(initialReceiveQuantity.trim()) ||
        Number(initialReceiveQuantity)>100000)) {
        setError(T("จำนวนรับเข้าเริ่มต้นต้องเป็นจำนวนเต็มบวก 1–100,000 ชิ้น"));return;
      }
      const err=checkRows(items,currency);
      if(err){setError(opticalStockError(lang,err));return;}
    }
    setBusy(true);setError("");
    const method=modal==="delete"?"DELETE":modal==="edit"?"PATCH":"POST";
    const destination=(modal==="add"||modal==="bulk")?targetBranchId:branchId;
    // Never send proposed counts into catalog create. Stock must go via audited RPC.
    const catalogItems=items.map(({initial_quantity: _proposedQuantity,...catalog})=>{
      void _proposedQuantity;
      return catalog;
    });
    const body=modal==="delete"?{id:selected?.id,branch_id:branchId}
      :modal==="edit"?{id:selected?.id,item:draft,branch_id:branchId}:{items:catalogItems,branch_id:destination};
    try{
      const res=await fetch("/api/pos/optical/catalog",{method,credentials:"same-origin",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"});
      const json=await res.json().catch(()=>null) as {error?:{message?:string}}|null;
      if(!res.ok)throw new Error(json?.error?.message??"บันทึกไม่สำเร็จ");
      if(modal==="add" && draft.sku.trim()){
        setNewProductCreated(true);setBusy(false);
        openStockAdjustment(draft.sku,destination);
        setAdjustQuantity(initialReceiveQuantity);
        return;
      }
      if(modal==="bulk"){
        const proposals=bulk.filter(item=>item.initial_quantity?.trim()).map(item=>({
          sku:item.sku.trim(),quantity:item.initial_quantity!.trim(),branchId:destination
        }));
        if(proposals.length){
          setNewProductCreated(true);setBulkReceiptTotal(proposals.length);
          setPendingBulkReceipts(proposals.slice(1));
          setBusy(false);
          openStockAdjustment(proposals[0].sku,destination);
          setAdjustQuantity(proposals[0].quantity);
          return;
        }
      }
      window.location.assign("/preview/pos/stock/custom?branch_id="+encodeURIComponent(destination));
    }catch(e){setError(opticalStockError(lang,e instanceof Error?e.message:"เกิดข้อผิดพลาด"));setBusy(false);}
  }
  const summaryCards:[string,number][]=[["สินค้า",rows.length],
    ["เหลือ 1",rows.filter(r=>r.opticalBin&&remaining(r)===1).length],
    ["หมด",rows.filter(r=>r.opticalBin&&remaining(r)===0).length],
    ["ยังไม่มีรายการรับเข้าสต๊อก",rows.filter(r=>!r.opticalBin).length]];
  const stockTabs:Kind[]=rows.some(row=>kind(row)==="accessory")
    ?["frame","lens","accessory"]:["frame","lens"];
  const pages=Array.from({length:totalPages},(_,i)=>i+1).filter(p=>
    totalPages<=7||p===1||p===totalPages||Math.abs(p-currentPage)<=2);
  return <main className="mx-auto h-full min-h-0 w-full max-w-7xl space-y-4 overflow-y-auto overscroll-y-contain px-3 pb-12 pt-3 lg:px-6" data-testid="custom-optical-inventory">
    <header className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-100 via-green-50 to-white p-5 shadow-sm">
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-x-4" data-testid="optical-inventory-toolbar">
        <PosBackButton lang={lang} href="/preview/pos/more" label={T("กลับเมนูเพิ่มเติม")}/>
        <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-3 lg:justify-end" data-testid="optical-inventory-actions">
          <label className="flex min-w-0 items-center gap-2 text-xs font-bold text-slate-700">
            <span className="shrink-0">{T("เลือกสาขา")}</span>
            <select aria-label={T("เลือกสาขาสต๊อก")} value={branchId}
              className={field+" !w-40 min-w-0"}
              disabled={branches.length<=1}
              onChange={e=>window.location.assign("/preview/pos/stock/custom?branch_id="+encodeURIComponent(e.target.value))}>
              {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <button type="button" className={btn} onClick={()=>show("summary")}>
            {T("ดูสรุปสต๊อก")}
          </button>
          {canManage?<button type="button" className="min-h-10 rounded-xl border border-emerald-700 bg-white px-4 py-2 text-sm font-bold text-emerald-800"
            onClick={()=>show("scan")}>{T("สแกนเพิ่ม/ลดสต๊อก")}</button>:null}
          <button type="button" className="min-h-10 rounded-xl border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-900"
            onClick={()=>show("best")}>{T("★ สินค้าขายดี")}</button>
          {canManage?<div className="flex flex-wrap items-center gap-3">
            <button type="button" className="min-h-10 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white" onClick={()=>show("add")}>{T("+ เพิ่มสินค้า")}</button>
            <button type="button" className="min-h-10 rounded-xl border border-emerald-600 bg-white px-4 py-2 text-sm font-bold text-emerald-800" onClick={()=>show("bulk")}>{T("+ สร้างสินค้าหลายรายการ")}</button>
          </div>:null}
        </div>
      </div>
    </header>
    {canManage?<div className="flex justify-end">
      <a href={"/preview/pos/stock/custom?branch_id="+encodeURIComponent(branchId)+(showInactive?"":"&show_inactive=1")}
        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
        {T(showInactive?"ซ่อนรายการหยุดขาย":"แสดงรายการหยุดขาย")}
      </a>
    </div>:null}
    {error&&!modal?<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}
    <nav role="tablist" aria-label={T("สลับประเภทสต๊อก Optical")} className="flex flex-wrap gap-2">
      {stockTabs.map(value=><button key={value} role="tab" type="button" aria-selected={tab===value}
        className={tab===value?"rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white":
          "rounded-xl border border-emerald-200 bg-white px-5 py-3 font-bold text-emerald-800"}
        onClick={()=>{setTab(value);setFilter("all");setPage(1);}}>
        {T(value==="frame"?"สต๊อกกรอบแว่น":value==="lens"?"สต๊อกเลนส์":"อุปกรณ์เสริม")}
      </button>)}
    </nav>
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-slate-50 p-4">
        <label className="min-w-[230px] flex-1 text-xs font-bold text-slate-600">{T("ค้นหา ชื่อสินค้า / SKU / บาร์โค้ด")}
          <input type="search" className={field+" mt-1"} value={search}
            onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder={T("ค้นหารายการสินค้า")}/>
        </label>
        <label className="text-xs font-bold text-slate-600">{T("ประเภท")}
          <select className={field+" mt-1"} value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}>
            <option value="all">{T("ทุกประเภท")}</option>{Object.entries(types).map(([k,v])=><option key={k} value={k}>{T(v)}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">{T("สถานะ")}
          <select className={field+" mt-1"} value={stock} onChange={e=>{setStock(e.target.value);setPage(1);}}>
            <option value="all">{T("ทั้งหมด")}</option><option value="available">{T("มีสินค้า")}</option><option value="low">{T("เหลือ 1")}</option>
            <option value="out">{T("หมด")}</option><option value="unverified">{T("ยังไม่มีรายการรับเข้าสต๊อก")}</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">{T("ต่อหน้า")}
          <select className={field+" mt-1"} value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}}>
            {[10,20,50,100].map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <div className="max-h-[min(62vh,720px)] overflow-auto overscroll-contain" role="region" aria-label={T("รายการสต๊อก Optical")} tabIndex={0}>
        <table className="w-full min-w-[1080px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-emerald-50 text-left text-slate-700"><tr>
            {["SKU / บาร์โค้ด","รูปสินค้า",...(tab==="frame"
              ?["แบรนด์","รุ่น","สี","ขนาด"]
              :tab==="lens"?["ยี่ห้อ","ชื่อเลนส์","Index","ค่าสายตา"]
              :["ชื่อสินค้า","ประเภท","รายละเอียด","หน่วย"]),
              "ราคา ("+currency+")","จำนวน","จำนวนคงเหลือ",...(canManage?["จัดการ"]:[])]
              .map(label=><th key={label} className="whitespace-nowrap px-3 py-3">{label.startsWith("ราคา (")?T("ราคา (")+currency+")":T(label)}</th>)}
          </tr></thead>
          <tbody>{subset.map(row=><tr key={row.id} className={"border-t border-slate-100 hover:bg-slate-50 "+(row.is_active?"":"bg-amber-50/60")}>
            <td className="px-3 py-3">
              <button type="button" className="whitespace-nowrap rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800"
                onClick={()=>show("sku",row)}>{T("ดูรหัส")}</button>
            </td>
            <td className="px-3 py-3">
              <button type="button" title={T("ดูหรืออัปโหลดรูปสินค้า")} className="rounded-lg border border-slate-200 p-1"
                onClick={()=>show("media",row)}>
                {images[row.id]?.thumbnail_url?<img src={images[row.id].thumbnail_url}
                  alt={row.name} className="h-12 w-12 rounded-md object-cover" loading="lazy"/>:
                  <span className="grid h-12 w-12 place-items-center text-[10px] text-slate-500">{T("+ รูป")}</span>}
              </button>
            </td>
            {tab==="frame"?<>
              <td className="px-3 py-3">{detail(row,"brand")}</td>
              <td className="px-3 py-3 font-semibold">{detail(row,"model")==="—"?row.name:detail(row,"model")}</td>
              <td className="px-3 py-3">{detail(row,"color")}</td>
              <td className="px-3 py-3">{detail(row,"frame_size")}</td>
            </>:tab==="lens"?<>
              <td className="px-3 py-3">{detail(row,"brand")}</td>
              <td className="px-3 py-3 font-semibold">{detail(row,"lens_name")}</td>
              <td className="px-3 py-3">{detail(row,"lens_index")}</td>
              <td className="px-3 py-3 whitespace-nowrap">
                SPH {detail(row,"lens_sph")} · CYL {detail(row,"lens_cyl")}
              </td>
            </>:<>
              <td className="px-3 py-3 font-semibold">{row.name}</td>
              <td className="px-3 py-3">{row.category??"—"}</td>
              <td className="px-3 py-3">—</td><td className="px-3 py-3">{row.sell_unit??T("ชิ้น")}</td>
            </>}
            <td className="px-3 py-3 text-right">{formatSalesMoney(Number(row.opticalBin?.unit_price??row.price),currency)}</td>
            <td className="px-3 py-3 text-right font-semibold">{initialCount(row)??"—"}</td>
            <td className="px-3 py-3 text-right font-semibold">
              {remaining(row)??"—"}
              {!row.opticalBin?<small className="block max-w-[180px] text-xs font-medium text-amber-800">{T("ยังไม่บันทึกจำนวนรับเข้าสต๊อก ไม่ใช่ยอดคงเหลือ 0")}</small>:null}
            </td>
            {canManage?<td className="whitespace-nowrap px-3 py-3">
              {!row.is_active?<span className="mr-2 inline-block rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">{T("หยุดขาย")}</span>:null}
              <button type="button" disabled={!row.is_active} className="mr-2 rounded-lg border border-blue-200 px-3 py-2 text-xs text-blue-700 disabled:opacity-40"
                onClick={()=>show("edit",row)}>{T("แก้ไข")}</button>
              <button type="button" disabled={!row.is_active} className="mr-2 rounded-lg border border-emerald-300 px-3 py-2 text-xs text-emerald-800 disabled:opacity-40"
                onClick={()=>openStockAdjustment(row.sku??"")}>{T("+/- สต๊อก")}</button>
              <button type="button" className="mr-2 rounded-lg border border-amber-300 px-3 py-2 text-xs text-amber-900"
                onClick={()=>void changeSaleVisibility(row,row.is_active?"archive":"restore")}>
                {T(row.is_active?"หยุดขาย":"เปิดขายอีกครั้ง")}</button>
              {row.is_active?<button type="button" className="rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-700"
                onClick={()=>show("delete",row)}>{T("ลบ")}</button>:null}
            </td>:null}
          </tr>)}</tbody>
        </table>
        {!subset.length?<p className="p-8 text-center text-sm text-slate-500">{T("ไม่พบสินค้าที่ตรงกับประเภทหรือเงื่อนไขค้นหา")}</p>:null}
      </div>
      <nav aria-label={T("แบ่งหน้าสินค้า")} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 text-sm">
        <span className="text-slate-600">{T("แสดง")} {displayed.length?(currentPage-1)*pageSize+1:0}–{Math.min(currentPage*pageSize,displayed.length)} {T("จาก")} {displayed.length} {T("รายการ")}</span>
        <div className="flex flex-wrap items-center gap-1">
          <button className={btn} disabled={currentPage===1} onClick={()=>setPage(v=>v-1)}>{T("ก่อนหน้า")}</button>
          {pages.map((n,i)=><span className="inline-flex items-center gap-1" key={n}>
            {i>0&&n-pages[i-1]>1?<span>…</span>:null}
            <button aria-current={currentPage===n?"page":undefined} onClick={()=>setPage(n)}
              className={currentPage===n?"min-h-10 rounded-xl bg-emerald-700 px-3 font-bold text-white":btn}>{n}</button>
          </span>)}
          <button className={btn} disabled={currentPage===totalPages} onClick={()=>setPage(v=>v+1)}>{T("ถัดไป")}</button>
        </div>
      </nav>
    </section>
    {modal?<div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/60 p-3">
      <section role="dialog" aria-modal="true" aria-labelledby="optical-modal-title"
        className={"flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl "+(modal==="bulk"||modal==="media"?"max-w-6xl":"max-w-xl")}>
        <header className="flex justify-between gap-3 border-b border-slate-200 p-5">
          <div><h2 id="optical-modal-title" className="text-lg font-extrabold">
            {T(modal==="add"?"เพิ่มสินค้า":modal==="edit"?"แก้ไขสินค้า":modal==="bulk"?"สร้างสินค้าหลายรายการ":modal==="sku"?"SKU / บาร์โค้ด":modal==="media"?"จัดการรูปสินค้า":modal==="best"?"สินค้าขายดี 30 วันย้อนหลัง":modal==="scan"?"สแกนบาร์โค้ดเพื่อเพิ่ม/ลดสต๊อก":modal==="summary"?"สรุปจำนวนสินค้าในสต๊อก":modal==="adjust"?"รับเข้า / เบิกออกสต๊อก Optical":"ยืนยันการลบสินค้า")}
          </h2>{modal!=="delete"&&modal!=="sku"&&modal!=="media"&&modal!=="best"&&modal!=="adjust"&&modal!=="scan"&&modal!=="summary"?<p className="mt-1 text-xs text-slate-500">{T("กรอกหรือสแกนบาร์โค้ดได้ · การสร้าง/แก้สินค้าไม่ใช่การรับสต๊อก · ต้องบันทึกจำนวนรับเข้าแยกด้วยรายการตรวจสอบ")}</p>:null}</div>
          <button aria-label={T("ปิด")} disabled={busy} className="px-2 text-xl" onClick={close}>×</button>
        </header>
        <div className="min-h-0 overflow-y-auto p-5">
          {modal==="scan"?<div className="space-y-4">
            <p className="text-sm text-slate-600">{T("ใช้เครื่องยิงบาร์โค้ดหรือพิมพ์ SKU แล้วกด Enter จากนั้นยืนยันการรับเข้า/เบิกออกในขั้นตอนถัดไป")}</p>
            <label className="block text-sm font-semibold">{T("SKU / บาร์โค้ดสินค้า")}
              <input className={field+" mt-1"} autoFocus autoComplete="off" spellCheck={false}
                value={scanSku} placeholder={T("ยิงบาร์โค้ดหรือกรอกรหัสสินค้า")}
                onChange={e=>{setScanSku(e.target.value);setError("");}}
                onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();handleBarcodeScan();}}}/>
            </label>
            <button type="button" className="min-h-10 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white"
              onClick={handleBarcodeScan}>{T("ค้นหาจากบาร์โค้ด")}</button>
            <div className="max-h-[35vh] space-y-2 overflow-y-auto" aria-label={T("ผลการค้นหาสินค้า")}>
              {rows.filter(r=>r.sku && (!scanSku.trim()||
                [r.name,r.sku].some(v=>String(v??"").toLowerCase().includes(scanSku.trim().toLowerCase()))))
                .slice(0,12).map(r=><button key={r.id} type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left text-sm hover:border-emerald-400"
                  onClick={()=>openStockAdjustment(r.sku??"")}>
                  <span className="font-semibold text-slate-800">{r.name}</span>
                  <span className="shrink-0 text-slate-500">{r.sku}</span>
                </button>)}
            </div>
          </div>:null}
          {modal==="summary"?<div>
            <p className="mb-4 text-sm text-slate-600">{branch} · {T("ยอดอ้างอิงจากสต๊อกที่ยืนยันแล้ว ไม่ถือว่าสินค้ารอรับเข้ามียอดเป็นศูนย์")}</p>
            <div className="grid grid-cols-2 gap-3">
              {summaryCards.map(([label,value])=><div key={label} className="rounded-xl border border-emerald-100 bg-emerald-50 p-4" >
                <p className="text-xs text-slate-600">{T(label)}</p>
                <strong className="mt-2 block text-2xl text-emerald-800">{value}</strong>
              </div>)}
            </div>
          </div>:null}
          {modal==="adjust"?<div className="grid gap-3">
            {newProductCreated?<p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              {bulkReceiptTotal>0
                ?"ยืนยันรับสต๊อกสินค้า "+(bulkReceiptTotal-pendingBulkReceipts.length)+"/"+bulkReceiptTotal+" รายการ · ยกเลิกเพื่อข้ามสินค้านี้ (จำนวนยังไม่รับเข้า)"
                :"บันทึกสินค้าแล้ว · กรุณายืนยันจำนวนรับเข้า หรือยกเลิกเพื่อรับเข้าภายหลัง"}
            </p>:null}
            <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800">
              {T("รายการนี้บันทึกจำนวนสต๊อกจริง ไม่แก้ราคาขาย ไม่รับเงิน และไม่ตัดใบงานซ้ำ")}
            </p>
            <label className="text-sm font-semibold">{T("SKU / บาร์โค้ด")}
              <input className={field+" mt-1"} value={adjustSku}
                autoFocus autoComplete="off" spellCheck={false} aria-invalid={adjustFieldError==="sku"}
                onKeyDown={e=>{if(e.key==="Enter")e.preventDefault();}}
                onChange={e=>{setAdjustSku(e.target.value);if(adjustFieldError==="sku"){setAdjustFieldError(null);setError("");}}}/>
              {adjustFieldError==="sku"&&error?<span role="alert" className="mt-1 block text-xs text-rose-700">{error}</span>:null}
            </label>
            {adjustBranchId===branchId?<label className="text-sm font-semibold">เลือกสินค้าจากรายการ
              <select className={field+" mt-1"} value={rows.some(r=>r.sku===adjustSku)?adjustSku:""}
                onChange={e=>setAdjustSku(e.target.value)}>
                <option value="">-- เลือกสินค้า หรือยิงบาร์โค้ดด้านบน --</option>
                {rows.filter(r=>r.sku).map(r=><option key={r.id} value={r.sku??""}>
                  {r.name} ({r.sku})
                </option>)}
              </select>
            </label>:null}
            <fieldset className="grid gap-2">
              <legend className="text-sm font-semibold">{T("ประเภทการปรับจำนวน")}</legend>
              <label className="flex items-center gap-2">
                <input type="radio" checked={adjustDirection==="receive"} onChange={()=>setAdjustDirection("receive")}/>
                {T("เพิ่มจำนวน (รับสินค้าเข้า)")}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={adjustDirection==="issue"} onChange={()=>setAdjustDirection("issue")}/>
                {T("ลดจำนวน (เบิกสินค้าออกโดยผู้จัดการ)")}
              </label>
            </fieldset>
            <label className="text-sm font-semibold">{T("จำนวนชิ้นที่ต้องการเพิ่ม/ลด *")}
              <input className={field+" mt-1"} inputMode="numeric" type="number"
                min={1} max={100000} step={1} value={adjustQuantity}
                aria-invalid={adjustFieldError==="quantity"}
                onChange={e=>{setAdjustQuantity(e.target.value);if(adjustFieldError==="quantity"){setAdjustFieldError(null);setError("");}}}/>
              {adjustFieldError==="quantity"&&error?<span role="alert" className="mt-1 block text-xs text-rose-700">{error}</span>:null}
            </label>
            <div className="text-sm font-semibold">
              <p className="mb-2">{T("เลือกเหตุผลอย่างรวดเร็ว (หรือพิมพ์เอง)")}</p>
              <div className="flex flex-wrap gap-2">
                {(adjustDirection==="receive"
                  ?["รับสินค้าตามใบส่งของ","รับสินค้าเข้าใหม่","ปรับยอดจากผลตรวจนับ"]
                  :["เบิกใช้ภายในร้าน","สินค้าชำรุด","ปรับยอดจากผลตรวจนับ"]
                ).map(reason=><button type="button" key={reason} className={btn+" min-h-9"}
                  onClick={()=>{setAdjustNote(reason);setError("");setAdjustFieldError(null);}}>{T(reason)}</button>)}
              </div>
            </div>
            <label className="text-sm font-semibold">{T("เหตุผล / เอกสารอ้างอิง *")}
              <textarea className={field+" mt-1"} value={adjustNote} minLength={3} maxLength={300} rows={2}
                aria-invalid={adjustFieldError==="note"}
                placeholder={T("เช่น รับสินค้าตามใบส่งของ / ปรับจากผลตรวจนับ")}
                onChange={e=>{setAdjustNote(e.target.value);if(adjustFieldError==="note"){setAdjustFieldError(null);setError("");}}}/>
              <span className="mt-1 block text-xs font-normal text-slate-500">{T("ต้องระบุเหตุผลอย่างน้อย 3 ตัวอักษร เพื่อบันทึกประวัติตรวจสอบ")}</span>
              {adjustFieldError==="note"&&error?<span role="alert" className="mt-1 block text-xs text-rose-700">{error}</span>:null}
            </label>
          </div>:null}
          {modal==="best"?<div className="space-y-3">
            <p className="text-sm text-slate-600">{T("สาขา: ")}{branch} · {T("จัดอันดับตามจำนวนที่ขายจริง (เฉพาะบิลสำเร็จ ไม่รวมยกเลิก)")}</p>
            {bestLoading?<p role="status">{T("กำลังรวบรวมยอดขาย...")}</p>:null}
            {bestError?<p role="alert" className="text-rose-700">{bestError}</p>:null}
            {!bestLoading&&!bestError&&!bestRows.length?<p className="rounded-lg bg-slate-50 p-5 text-center">{T("ไม่พบยอดขายสินค้า Optical ใน 30 วันที่ผ่านมา")}</p>:null}
            {sampled?<p role="note" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{T("ยอดขายมีมากกว่า 2,000 บิล แสดงอันดับจาก 2,000 บิลล่าสุดเท่านั้น")}</p>:null}
            {bestRows.length?<div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
              <thead className="bg-emerald-50"><tr>{["อันดับ","สินค้า","จำนวนขาย (ชิ้น)","ยอดขาย"].map(x=><th key={x} className="px-3 py-2 text-left">{T(x)}</th>)}</tr></thead>
              <tbody>{bestRows.map((x,i)=><tr key={x.product_id} className="border-b">
                <td className="px-3 py-3 font-bold">{i+1}</td>
                <td className="px-3 py-3">{x.name}</td>
                <td className="px-3 py-3 text-right">{x.units}</td>
                <td className="px-3 py-3 text-right">{formatSalesMoney(x.revenue,currency)}</td>
              </tr>)}</tbody></table></div>:null}
          </div>:null}
          {modal==="media"&&selected?<ProductMediaManager
            th={lang==="th"} language={lang} branchId={branchId} branchName={branch} canManage={canManage}
            products={[{id:selected.id,sku:selected.sku??"",name:selected.name,category:selected.category??"Optical"}]}/>:null}
          {modal==="sku"?<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-sm text-slate-600">{selected?.name}</p>
            <code className="mt-3 block break-all text-lg font-bold text-slate-900">{selected?.sku??"—"}</code>
            <button type="button" className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white"
              onClick={()=>void navigator.clipboard?.writeText(selected?.sku??"")}>{T("คัดลอกรหัส")}</button>
          </div>:null}
          {modal==="delete"?<p className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">
            {T("ต้องการลบสินค้า")} <strong>{selected?.name}</strong> {T("ใช่หรือไม่? ระบบใช้ Soft Delete และจะบล็อกสินค้าที่มีสต๊อก สูตร หรือใบสั่งงานผูกอยู่")}
            <span className="mt-2 block font-semibold">{T("หากสินค้าเคยรับเข้า มีการจอง หรือมีใบสั่งงาน ให้ใช้ปุ่มหยุดขายแทน โดยจะเก็บยอดและประวัติทั้งหมดไว้")}</span>
          </p>:null}
          {(modal==="add"||modal==="bulk")?<label className="mb-4 block text-sm font-bold">{T("เลือกสาขาที่ต้องการลงสินค้า")}
            <select value={targetBranchId} className={field+" mt-2"} onChange={e=>setTargetBranchId(e.target.value)}>
              {branches.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}
            </select></label>:null}
          {(modal==="add"||modal==="edit")?<div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2 text-sm font-semibold">{T("ชื่อสินค้า *")}
              <input className={field+" mt-1"} maxLength={180} value={draft.name} onChange={e=>change("name",e.target.value)}/>
            </label>
            <label className="text-sm font-semibold">{T("ประเภท *")}
              <select className={field+" mt-1"} value={draft.kind} onChange={e=>change("kind",e.target.value)}>
                {Object.entries(types).map(([k,v])=><option key={k} value={k}>{T(v)}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold">{T("แบรนด์ / ยี่ห้อ")}
              <input className={field+" mt-1"} value={draft.brand} maxLength={120}
                onChange={e=>change("brand",e.target.value)}/>
            </label>
            {draft.kind==="frame"?<>
              <label className="text-sm font-semibold">{T("รุ่น")}
                <input className={field+" mt-1"} value={draft.model} maxLength={120}
                  onChange={e=>change("model",e.target.value)}/></label>
              <label className="text-sm font-semibold">{T("สี")}
                <input className={field+" mt-1"} value={draft.color} maxLength={80}
                  onChange={e=>change("color",e.target.value)}/></label>
              <label className="text-sm font-semibold">{T("ขนาด")}
                <input className={field+" mt-1"} value={draft.frame_size} maxLength={60}
                  onChange={e=>change("frame_size",e.target.value)}/></label>
            </>:draft.kind==="lens"?<>
              <label className="text-sm font-semibold">{T("ชื่อเลนส์")}
                <input className={field+" mt-1"} value={draft.lens_name} maxLength={120}
                  onChange={e=>change("lens_name",e.target.value)}/></label>
              <label className="text-sm font-semibold">Index
                <input className={field+" mt-1"} value={draft.lens_index} maxLength={40}
                  onChange={e=>change("lens_index",e.target.value)}/></label>
              <label className="text-sm font-semibold">SPH
                <input className={field+" mt-1"} type="number" step="0.25" value={draft.lens_sph}
                  onChange={e=>change("lens_sph",e.target.value)}/></label>
              <label className="text-sm font-semibold">CYL
                <input className={field+" mt-1"} type="number" step="0.25" value={draft.lens_cyl}
                  onChange={e=>change("lens_cyl",e.target.value)}/></label>
              <label className="text-sm font-semibold">Axis
                <input className={field+" mt-1"} type="number" min="0" max="180" value={draft.lens_axis}
                  onChange={e=>change("lens_axis",e.target.value)}/></label>
            </>:null}
            <label className="text-sm font-semibold">{T("SKU / บาร์โค้ด (กรอกหรือสแกน) *")}
              <input className={field+" mt-1"} value={draft.sku} maxLength={90} autoComplete="off" spellCheck={false} onKeyDown={e=>{if(e.key==="Enter")e.preventDefault();}} onChange={e=>change("sku",e.target.value)}/>
            </label>
            <label className="text-sm font-semibold">{T("ราคา (")}{currency}) *
              <input className={field+" mt-1"} value={draft.price} type="number" min="0"
                step={currency==="LAK"?"1":"0.01"} onChange={e=>change("price",e.target.value)}/>
            </label>
            <label className="text-sm font-semibold">{T("หน่วย")}
              <input className={field+" mt-1"} value={draft.unit} maxLength={30} onChange={e=>change("unit",e.target.value)}/>
            </label>
            {modal==="add"?<label className="sm:col-span-2 text-sm font-semibold">
              {T("จำนวนรับเข้าเริ่มต้น (จะเปิดหน้าต่างยืนยันสต๊อกแยก)")}
              <input type="number" min={1} max={100000} step={1}
                className={field+" mt-1"} value={initialReceiveQuantity}
                onChange={e=>setInitialReceiveQuantity(e.target.value)}/>
            </label>:null}
            {modal==="edit"?<div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-sm font-semibold">{T("จำนวนคงเหลือที่ยืนยันแล้ว")}: {selected?remaining(selected)??"—":"—"}</p>
              <p className="mt-1 text-xs">{T("กดปรับจำนวนเพื่อรับสินค้าเข้าหรือเบิกออก โดยมีประวัติตรวจสอบ")}</p>
              <button type="button" className={btn+" mt-2"} onClick={()=>openStockAdjustment(selected?.sku??"")}>
                {T("+/- ปรับจำนวนสต๊อก")}
              </button>
            </div>:null}
            <label className="sm:col-span-2 text-sm font-semibold">{T("หมายเหตุ")}
              <textarea className={field+" mt-1"} value={draft.note} maxLength={500} rows={2} onChange={e=>change("note",e.target.value)}/>
            </label>
          </div>:null}
          {modal==="bulk"?<>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-[1650px] w-full text-sm">
                <thead className="bg-emerald-50 text-left"><tr>{["#","ชื่อสินค้า *","ประเภท","SKU / บาร์โค้ด *","แบรนด์ / ยี่ห้อ","รุ่น / ชื่อเลนส์","สี / Index","ขนาด / SPH","CYL","ราคา ("+currency+") *","หน่วย","จำนวนรับเข้าเริ่มต้น","ลบแถว"].map(x=><th className="p-2" key={x}>{x.startsWith("ราคา (")?T("ราคา (")+currency+") *":T(x)}</th>)}</tr></thead>
                <tbody>{bulk.map((row,i)=><tr className="border-t border-slate-100" key={i}>
                  <td className="p-2">{i+1}</td>
                  <td className="p-2"><input className={field} maxLength={180} value={row.name} onChange={e=>changeBulk(i,"name",e.target.value)}/></td>
                  <td className="p-2"><select className={field+" min-w-[130px]"} value={row.kind} onChange={e=>changeBulk(i,"kind",e.target.value)}>
                    {Object.entries(types).map(([k,v])=><option key={k} value={k}>{T(v)}</option>)}
                  </select></td>
                  <td className="p-2"><input className={field} value={row.sku} maxLength={90} autoComplete="off" spellCheck={false} onKeyDown={e=>{if(e.key==="Enter")e.preventDefault();}} onChange={e=>changeBulk(i,"sku",e.target.value)} placeholder={T("กรอกหรือสแกน")}/></td>
                  <td className="p-2"><input className={field} maxLength={120} value={row.brand}
                    onChange={e=>changeBulk(i,"brand",e.target.value)}/></td>
                  <td className="p-2"><input className={field} maxLength={120}
                    value={row.kind==="lens"?row.lens_name:row.model}
                    onChange={e=>changeBulk(i,row.kind==="lens"?"lens_name":"model",e.target.value)}/></td>
                  <td className="p-2"><input className={field} maxLength={80}
                    value={row.kind==="lens"?row.lens_index:row.color}
                    onChange={e=>changeBulk(i,row.kind==="lens"?"lens_index":"color",e.target.value)}/></td>
                  <td className="p-2"><input className={field} maxLength={60}
                    value={row.kind==="lens"?row.lens_sph:row.frame_size}
                    onChange={e=>changeBulk(i,row.kind==="lens"?"lens_sph":"frame_size",e.target.value)}/></td>
                  <td className="p-2">{row.kind==="lens"?<input className={field}
                    value={row.lens_cyl} onChange={e=>changeBulk(i,"lens_cyl",e.target.value)}/>: "—"}</td>
                  <td className="p-2"><input className={field} type="number" min="0" step={currency==="LAK"?"1":"0.01"}
                    value={row.price} onChange={e=>changeBulk(i,"price",e.target.value)}/></td>
                  <td className="p-2"><input className={field} value={row.unit} maxLength={30} onChange={e=>changeBulk(i,"unit",e.target.value)}/></td>
                  <td className="p-2"><input className={field+" min-w-[110px]"} type="number" min={1} max={100000} step={1}
                    aria-label={"จำนวนรับเข้าเริ่มต้น แถว "+(i+1)} placeholder="รอยืนยัน"
                    value={row.initial_quantity??""} onChange={e=>changeBulk(i,"initial_quantity",e.target.value)}/></td>
                  <td className="p-2"><button className="rounded-lg px-2 py-2 text-rose-700 disabled:opacity-40" disabled={bulk.length===1}
                    onClick={()=>setBulk(old=>old.filter((_,j)=>i!==j))}>{T("ลบ")}</button></td>
                </tr>)}</tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-amber-800">ช่องจำนวนใช้เสนอรับเข้าเริ่มต้นเท่านั้น · หลังบันทึกสินค้าต้องยืนยันใน Pop-up ทีละรายการ (ไม่รับเข้าอัตโนมัติ)</p>
            <div className="mt-3 flex justify-between gap-2">
              <button className={btn} disabled={bulk.length>=50||busy} onClick={()=>setBulk(r=>[...r,{...blank(),kind:tab}])}>{T("+ เพิ่มแถว")}</button>
              <span className="text-xs text-slate-500">{bulk.length}/50 รายการ</span>
            </div>
          </>:null}
          {error&&(modal!=="adjust"||!adjustFieldError)?<p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
          <button className={btn} disabled={busy} onClick={close}>{T("ยกเลิก")}</button>
          {modal==="adjust"?<button className="min-h-10 rounded-xl bg-emerald-700 px-5 py-2 text-sm font-bold text-white disabled:opacity-50"
              disabled={busy} onClick={()=>void saveStockAdjustment()}>{T(busy?"กำลังบันทึก...":"ยืนยันปรับสต๊อก")}</button>:null}
          {modal!=="sku"&&modal!=="media"&&modal!=="best"&&modal!=="adjust"&&modal!=="scan"&&modal!=="summary"?<button className={"min-h-10 rounded-xl px-5 py-2 text-sm font-bold text-white disabled:opacity-50 "+(modal==="delete"?"bg-rose-700":"bg-emerald-700")}
            disabled={busy} onClick={()=>void save()}>{T(busy?"กำลังบันทึก...":modal==="delete"?"ยืนยันลบ":modal==="bulk"?"บันทึกทั้งหมด":"บันทึก")}</button>:null}
        </footer>
      </section>
    </div>:null}
  </main>;
}