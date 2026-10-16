"use client";

import {useEffect,useMemo,useState} from "react";
import {ProductMediaManager} from "@/components/pos-preview/product-media-manager";
import {formatSalesMoney,type SalesCurrencyCode} from "@/lib/pos-money";
import {PosBackButton} from "@/components/pos-preview/pos-back-button";

export type OpticalRow={
  id:string;name:string;sku:string|null;category:string|null;price:number;
  sell_unit:string|null;metadata:Record<string,unknown>|null;
  available:number|null;recipeAttached:boolean;
  opticalBin?:{product_id:string;kind:string;brand:string|null;model:string|null;
    color:string|null;frame_size:string|null;lens_type:string|null;lens_index:string|null;
    lens_sph:number|null;lens_cyl:number|null;on_hand:number;reserved:number;unit_price:number;currency_code:string}|null
};
type Kind="frame"|"lens"|"accessory";
type Draft={name:string;sku:string;kind:Kind;price:string;unit:string;note:string;
  brand:string;model:string;color:string;frame_size:string;lens_name:string;
  lens_index:string;lens_sph:string;lens_cyl:string;lens_axis:string};
type Modal=null|"add"|"bulk"|"edit"|"delete"|"sku"|"media"|"best";
const types:Record<Kind,string>={frame:"กรอบแว่น",lens:"เลนส์",accessory:"อุปกรณ์เสริม"};
const blank=():Draft=>({name:"",sku:"",kind:"frame",price:"",unit:"ชิ้น",note:"",
  brand:"",model:"",color:"",frame_size:"",lens_name:"",lens_index:"",lens_sph:"",lens_cyl:"",lens_axis:""});
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
    if(!r.price.trim()||!Number.isFinite(price)||price<0||
      (currency==="LAK"&&!Number.isInteger(price))||Math.round(price*100)/100!==price)
      return "ราคาสินค้าไม่ถูกต้อง ในแถว "+(i+1);
  }
  return "";
}
export function OpticalStockWorkspace({rows,branch,branchId,branches,currency,canManage}:{
  rows:OpticalRow[];branch:string;branchId:string;branches:{id:string;name:string}[];currency:SalesCurrencyCode;canManage:boolean
}){
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
      }).catch(e=>{if(!controller.signal.aborted)setBestError(e instanceof Error?e.message:"โหลดไม่สำเร็จ");})
      .finally(()=>{if(!controller.signal.aborted)setBestLoading(false);});
    return()=>controller.abort();
  },[modal,branchId]);
  const change=(key:keyof Draft,value:string)=>setDraft(s=>({...s,[key]:value}));
  const changeBulk=(idx:number,key:keyof Draft,value:string)=>
    setBulk(s=>s.map((r,i)=>i===idx?{...r,[key]:value}:r));
  const show=(m:Modal,r?:OpticalRow)=>{
    setError("");setSelected(r??null);setModal(m);
    if(m==="add")setDraft({...blank(),kind:tab});
    if(m==="add"||m==="bulk")setTargetBranchId(branchId);
    if(m==="edit"&&r)setDraft(forEdit(r));
    if(m==="bulk")setBulk([blank(),blank(),blank()].map(row=>({...row,kind:tab})));
  };
  const close=()=>{if(!busy){setModal(null);setError("");}};
  async function save(){
    if(!modal||busy)return;
    if(modal==="sku"||modal==="media"||modal==="best")return;
    const items=modal==="bulk"?bulk:[draft];
    if(modal!=="delete"){
      const err=checkRows(items,currency);
      if(err){setError(err);return;}
    }
    setBusy(true);setError("");
    const method=modal==="delete"?"DELETE":modal==="edit"?"PATCH":"POST";
    const destination=(modal==="add"||modal==="bulk")?targetBranchId:branchId;
    const body=modal==="delete"?{id:selected?.id,branch_id:branchId}
      :modal==="edit"?{id:selected?.id,item:draft,branch_id:branchId}:{items,branch_id:destination};
    try{
      const res=await fetch("/api/pos/optical/catalog",{method,credentials:"same-origin",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"});
      const json=await res.json().catch(()=>null) as {error?:{message?:string}}|null;
      if(!res.ok)throw new Error(json?.error?.message??"บันทึกไม่สำเร็จ");
      window.location.assign("/preview/pos/stock/custom?branch_id="+encodeURIComponent(destination));
    }catch(e){setError(e instanceof Error?e.message:"เกิดข้อผิดพลาด");setBusy(false);}
  }
  const summaryCards:[string,number][]=[["สินค้า",rows.length],
    ["เหลือ 1",rows.filter(r=>r.opticalBin&&remaining(r)===1).length],
    ["หมด",rows.filter(r=>r.opticalBin&&remaining(r)===0).length],
    ["รอตรวจสต๊อก",rows.filter(r=>!r.opticalBin).length]];
  const stockTabs:Kind[]=rows.some(row=>kind(row)==="accessory")
    ?["frame","lens","accessory"]:["frame","lens"];
  const pages=Array.from({length:totalPages},(_,i)=>i+1).filter(p=>
    totalPages<=7||p===1||p===totalPages||Math.abs(p-currentPage)<=2);
  return <main className="mx-auto h-full min-h-0 w-full max-w-7xl space-y-4 overflow-y-auto overscroll-y-contain px-3 pb-12 pt-3 lg:px-6" data-testid="custom-optical-inventory">
    <header className="rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-100 via-green-50 to-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PosBackButton lang="th" href="/preview/pos/more" label="กลับเมนูเพิ่มเติม"/>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-bold text-slate-700">เลือกสาขา
            <select aria-label="เลือกสาขาสต๊อก" value={branchId}
              className={field+" ml-2 w-auto"}
              disabled={branches.length<=1}
              onChange={e=>window.location.assign("/preview/pos/stock/custom?branch_id="+encodeURIComponent(e.target.value))}>
              {branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <button className="min-h-10 rounded-xl border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-900"
            onClick={()=>show("best")}>★ สินค้าขายดี</button>
        {canManage?<div className="flex flex-wrap gap-2">
          <button className="min-h-10 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white" onClick={()=>show("add")}>+ เพิ่มสินค้า</button>
          <button className="min-h-10 rounded-xl border border-emerald-600 bg-white px-4 py-2 text-sm font-bold text-emerald-800" onClick={()=>show("bulk")}>+ สร้างสินค้าหลายรายการ</button>
        </div>:null}
        </div>
      </div>
      <p className="mt-3 text-xs font-bold tracking-widest text-emerald-800">CUSTOM · OPTICAL INVENTORY</p>
      <h1 className="mt-1 text-2xl font-extrabold text-slate-900">สต๊อกกรอบแว่นและเลนส์</h1>
      <p className="mt-1 text-sm text-slate-600">{branch} · ข้อมูลแยกตาม Tenant และ Branch</p>
    </header>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {summaryCards.map(([label,value])=><div key={label} className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">{label}</p><strong className="mt-2 block text-2xl text-emerald-800">{value}</strong>
        </div>)}
    </section>
    <nav role="tablist" aria-label="สลับประเภทสต๊อก Optical" className="flex flex-wrap gap-2">
      {stockTabs.map(value=><button key={value} role="tab" type="button" aria-selected={tab===value}
        className={tab===value?"rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white":
          "rounded-xl border border-emerald-200 bg-white px-5 py-3 font-bold text-emerald-800"}
        onClick={()=>{setTab(value);setFilter("all");setPage(1);}}>
        {value==="frame"?"สต๊อกกรอบแว่น":value==="lens"?"สต๊อกเลนส์":"อุปกรณ์เสริม"}
      </button>)}
    </nav>
    <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 bg-slate-50 p-4">
        <label className="min-w-[230px] flex-1 text-xs font-bold text-slate-600">ค้นหา ชื่อสินค้า / SKU / บาร์โค้ด
          <input type="search" className={field+" mt-1"} value={search}
            onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="ค้นหารายการสินค้า"/>
        </label>
        <label className="text-xs font-bold text-slate-600">ประเภท
          <select className={field+" mt-1"} value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}>
            <option value="all">ทุกประเภท</option>{Object.entries(types).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">สถานะ
          <select className={field+" mt-1"} value={stock} onChange={e=>{setStock(e.target.value);setPage(1);}}>
            <option value="all">ทั้งหมด</option><option value="available">มีสินค้า</option><option value="low">เหลือ 1</option>
            <option value="out">หมด</option><option value="unverified">รอยืนยัน</option>
          </select>
        </label>
        <label className="text-xs font-bold text-slate-600">ต่อหน้า
          <select className={field+" mt-1"} value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}}>
            {[10,20,50,100].map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <div className="max-h-[min(62vh,720px)] overflow-auto overscroll-contain" role="region" aria-label="รายการสต๊อก Optical" tabIndex={0}>
        <table className="w-full min-w-[1080px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-emerald-50 text-left text-slate-700"><tr>
            {["SKU / บาร์โค้ด","รูปสินค้า",...(tab==="frame"
              ?["แบรนด์","รุ่น","สี","ขนาด"]
              :tab==="lens"?["ยี่ห้อ","ชื่อเลนส์","Index","ค่าสายตา"]
              :["ชื่อสินค้า","ประเภท","รายละเอียด","หน่วย"]),
              "ราคา ("+currency+")","จำนวน","จำนวนคงเหลือ",...(canManage?["จัดการ"]:[])]
              .map(label=><th key={label} className="whitespace-nowrap px-3 py-3">{label}</th>)}
          </tr></thead>
          <tbody>{subset.map(row=><tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
            <td className="px-3 py-3">
              <button type="button" className="whitespace-nowrap rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800"
                onClick={()=>show("sku",row)}>ดูรหัส</button>
            </td>
            <td className="px-3 py-3">
              <button type="button" title="ดูหรืออัปโหลดรูปสินค้า" className="rounded-lg border border-slate-200 p-1"
                onClick={()=>show("media",row)}>
                {images[row.id]?.thumbnail_url?<img src={images[row.id].thumbnail_url}
                  alt={row.name} className="h-12 w-12 rounded-md object-cover" loading="lazy"/>:
                  <span className="grid h-12 w-12 place-items-center text-[10px] text-slate-500">+ รูป</span>}
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
              <td className="px-3 py-3">—</td><td className="px-3 py-3">{row.sell_unit??"ชิ้น"}</td>
            </>}
            <td className="px-3 py-3 text-right">{formatSalesMoney(Number(row.opticalBin?.unit_price??row.price),currency)}</td>
            <td className="px-3 py-3 text-right font-semibold">{initialCount(row)??"—"}</td>
            <td className="px-3 py-3 text-right font-semibold">
              {remaining(row)??"รอยืนยัน"}
              {!row.opticalBin?<small className="block text-xs text-amber-700">ยังไม่รับรองยอด Optical</small>:null}
            </td>
            {canManage?<td className="whitespace-nowrap px-3 py-3">
              <button type="button" className="mr-2 rounded-lg border border-blue-200 px-3 py-2 text-xs text-blue-700"
                onClick={()=>show("edit",row)}>แก้ไข</button>
              <button type="button" className="rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-700"
                onClick={()=>show("delete",row)}>ลบ</button>
            </td>:null}
          </tr>)}</tbody>
        </table>
        {!subset.length?<p className="p-8 text-center text-sm text-slate-500">ไม่พบสินค้าที่ตรงกับประเภทหรือเงื่อนไขค้นหา</p>:null}
      </div>
      <nav aria-label="แบ่งหน้าสินค้า" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 text-sm">
        <span className="text-slate-600">แสดง {displayed.length?(currentPage-1)*pageSize+1:0}–{Math.min(currentPage*pageSize,displayed.length)} จาก {displayed.length} รายการ</span>
        <div className="flex flex-wrap items-center gap-1">
          <button className={btn} disabled={currentPage===1} onClick={()=>setPage(v=>v-1)}>ก่อนหน้า</button>
          {pages.map((n,i)=><span className="inline-flex items-center gap-1" key={n}>
            {i>0&&n-pages[i-1]>1?<span>…</span>:null}
            <button aria-current={currentPage===n?"page":undefined} onClick={()=>setPage(n)}
              className={currentPage===n?"min-h-10 rounded-xl bg-emerald-700 px-3 font-bold text-white":btn}>{n}</button>
          </span>)}
          <button className={btn} disabled={currentPage===totalPages} onClick={()=>setPage(v=>v+1)}>ถัดไป</button>
        </div>
      </nav>
    </section>
    {modal?<div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/60 p-3">
      <section role="dialog" aria-modal="true" aria-labelledby="optical-modal-title"
        className={"flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl "+(modal==="bulk"||modal==="media"?"max-w-6xl":"max-w-xl")}>
        <header className="flex justify-between gap-3 border-b border-slate-200 p-5">
          <div><h2 id="optical-modal-title" className="text-lg font-extrabold">
            {modal==="add"?"เพิ่มสินค้า":modal==="edit"?"แก้ไขสินค้า":modal==="bulk"?"สร้างสินค้าหลายรายการ":modal==="sku"?"SKU / บาร์โค้ด":modal==="media"?"จัดการรูปสินค้า":modal==="best"?"สินค้าขายดี 30 วันย้อนหลัง":"ยืนยันการลบสินค้า"}
          </h2>{modal!=="delete"&&modal!=="sku"&&modal!=="media"&&modal!=="best"?<p className="mt-1 text-xs text-slate-500">SKU / บาร์โค้ด กรอกเองได้ · ไม่เปลี่ยนจำนวนสต๊อกอัตโนมัติ</p>:null}</div>
          <button aria-label="ปิด" disabled={busy} className="px-2 text-xl" onClick={close}>×</button>
        </header>
        <div className="min-h-0 overflow-y-auto p-5">
          {modal==="best"?<div className="space-y-3">
            <p className="text-sm text-slate-600">สาขา: {branch} · จัดอันดับตามจำนวนที่ขายจริง (เฉพาะบิลสำเร็จ ไม่รวมยกเลิก)</p>
            {bestLoading?<p role="status">กำลังรวบรวมยอดขาย...</p>:null}
            {bestError?<p role="alert" className="text-rose-700">{bestError}</p>:null}
            {!bestLoading&&!bestError&&!bestRows.length?<p className="rounded-lg bg-slate-50 p-5 text-center">ไม่พบยอดขายสินค้า Optical ใน 30 วันที่ผ่านมา</p>:null}
            {sampled?<p role="note" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">ยอดขายมีมากกว่า 2,000 บิล แสดงอันดับจาก 2,000 บิลล่าสุดเท่านั้น</p>:null}
            {bestRows.length?<div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm">
              <thead className="bg-emerald-50"><tr>{["อันดับ","สินค้า","จำนวนขาย (ชิ้น)","ยอดขาย"].map(x=><th key={x} className="px-3 py-2 text-left">{x}</th>)}</tr></thead>
              <tbody>{bestRows.map((x,i)=><tr key={x.product_id} className="border-b">
                <td className="px-3 py-3 font-bold">{i+1}</td>
                <td className="px-3 py-3">{x.name}</td>
                <td className="px-3 py-3 text-right">{x.units}</td>
                <td className="px-3 py-3 text-right">{formatSalesMoney(x.revenue,currency)}</td>
              </tr>)}</tbody></table></div>:null}
          </div>:null}
          {modal==="media"&&selected?<ProductMediaManager
            th branchId={branchId} branchName={branch} canManage={canManage}
            products={[{id:selected.id,sku:selected.sku??"",name:selected.name,category:selected.category??"Optical"}]}/>:null}
          {modal==="sku"?<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-sm text-slate-600">{selected?.name}</p>
            <code className="mt-3 block break-all text-lg font-bold text-slate-900">{selected?.sku??"—"}</code>
            <button type="button" className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white"
              onClick={()=>void navigator.clipboard?.writeText(selected?.sku??"")}>คัดลอกรหัส</button>
          </div>:null}
          {modal==="delete"?<p className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">
            ต้องการลบสินค้า <strong>{selected?.name}</strong> ใช่หรือไม่? ระบบใช้ Soft Delete และจะบล็อกสินค้าที่มีสต๊อก สูตร หรือใบสั่งงานผูกอยู่
          </p>:null}
          {(modal==="add"||modal==="bulk")?<label className="mb-4 block text-sm font-bold">เลือกสาขาที่ต้องการลงสินค้า
            <select value={targetBranchId} className={field+" mt-2"} onChange={e=>setTargetBranchId(e.target.value)}>
              {branches.map(option=><option key={option.id} value={option.id}>{option.name}</option>)}
            </select></label>:null}
          {(modal==="add"||modal==="edit")?<div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2 text-sm font-semibold">ชื่อสินค้า *
              <input className={field+" mt-1"} maxLength={180} value={draft.name} onChange={e=>change("name",e.target.value)}/>
            </label>
            <label className="text-sm font-semibold">ประเภท *
              <select className={field+" mt-1"} value={draft.kind} onChange={e=>change("kind",e.target.value)}>
                {Object.entries(types).map(([k,v])=><option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="text-sm font-semibold">แบรนด์ / ยี่ห้อ
              <input className={field+" mt-1"} value={draft.brand} maxLength={120}
                onChange={e=>change("brand",e.target.value)}/>
            </label>
            {draft.kind==="frame"?<>
              <label className="text-sm font-semibold">รุ่น
                <input className={field+" mt-1"} value={draft.model} maxLength={120}
                  onChange={e=>change("model",e.target.value)}/></label>
              <label className="text-sm font-semibold">สี
                <input className={field+" mt-1"} value={draft.color} maxLength={80}
                  onChange={e=>change("color",e.target.value)}/></label>
              <label className="text-sm font-semibold">ขนาด
                <input className={field+" mt-1"} value={draft.frame_size} maxLength={60}
                  onChange={e=>change("frame_size",e.target.value)}/></label>
            </>:draft.kind==="lens"?<>
              <label className="text-sm font-semibold">ชื่อเลนส์
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
            <label className="text-sm font-semibold">SKU / บาร์โค้ด (กรอกเอง) *
              <input className={field+" mt-1"} value={draft.sku} maxLength={90} onChange={e=>change("sku",e.target.value)}/>
            </label>
            <label className="text-sm font-semibold">ราคา ({currency}) *
              <input className={field+" mt-1"} value={draft.price} type="number" min="0"
                step={currency==="LAK"?"1":"0.01"} onChange={e=>change("price",e.target.value)}/>
            </label>
            <label className="text-sm font-semibold">หน่วย
              <input className={field+" mt-1"} value={draft.unit} maxLength={30} onChange={e=>change("unit",e.target.value)}/>
            </label>
            <label className="sm:col-span-2 text-sm font-semibold">หมายเหตุ
              <textarea className={field+" mt-1"} value={draft.note} maxLength={500} rows={2} onChange={e=>change("note",e.target.value)}/>
            </label>
          </div>:null}
          {modal==="bulk"?<>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-[850px] w-full text-sm">
                <thead className="bg-emerald-50 text-left"><tr>{["#","ชื่อสินค้า *","ประเภท","SKU / บาร์โค้ด *","แบรนด์ / ยี่ห้อ","รุ่น / ชื่อเลนส์","สี / Index","ขนาด / SPH","CYL","ราคา ("+currency+") *","หน่วย","ลบแถว"].map(x=><th className="p-2" key={x}>{x}</th>)}</tr></thead>
                <tbody>{bulk.map((row,i)=><tr className="border-t border-slate-100" key={i}>
                  <td className="p-2">{i+1}</td>
                  <td className="p-2"><input className={field} maxLength={180} value={row.name} onChange={e=>changeBulk(i,"name",e.target.value)}/></td>
                  <td className="p-2"><select className={field} value={row.kind} onChange={e=>changeBulk(i,"kind",e.target.value)}>
                    {Object.entries(types).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                  </select></td>
                  <td className="p-2"><input className={field} value={row.sku} maxLength={90} onChange={e=>changeBulk(i,"sku",e.target.value)} placeholder="กรอกเอง"/></td>
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
                  <td className="p-2"><button className="rounded-lg px-2 py-2 text-rose-700 disabled:opacity-40" disabled={bulk.length===1}
                    onClick={()=>setBulk(old=>old.filter((_,j)=>i!==j))}>ลบ</button></td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-between gap-2">
              <button className={btn} disabled={bulk.length>=50||busy} onClick={()=>setBulk(r=>[...r,{...blank(),kind:tab}])}>+ เพิ่มแถว</button>
              <span className="text-xs text-slate-500">{bulk.length}/50 รายการ</span>
            </div>
          </>:null}
          {error?<p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
          <button className={btn} disabled={busy} onClick={close}>ยกเลิก</button>
          {modal!=="sku"&&modal!=="media"&&modal!=="best"?<button className={"min-h-10 rounded-xl px-5 py-2 text-sm font-bold text-white disabled:opacity-50 "+(modal==="delete"?"bg-rose-700":"bg-emerald-700")}
            disabled={busy} onClick={()=>void save()}>{busy?"กำลังบันทึก...":modal==="delete"?"ยืนยันลบ":modal==="bulk"?"บันทึกทั้งหมด":"บันทึก"}</button>:null}
        </footer>
      </section>
    </div>:null}
  </main>;
}