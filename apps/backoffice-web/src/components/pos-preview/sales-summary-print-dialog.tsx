"use client";

import { useState } from "react";
import type { Language } from "@/lib/i18n";
import type { PosSalesSummaryPayload } from "@/lib/services/pos-sales-summary-service";
import type { SalesPrintKind } from "@/lib/printing/sales-summary-report-html";
import { hasLocalWindowsPrintBridge, printWindowsReceiptHtml } from "@/lib/printing/windows-local-printer-test";

export type SalesPrintTarget = { kind: SalesPrintKind; rowId?: string | null };
type Period = "filtered" | "day" | "month" | "year" | "range";
type ApiReply = { data?: { html?: string; title?: string; queued?: boolean; previewHash?: string }; error?: { message?: string; code?: string } };
const kindNames: Record<SalesPrintKind,string> = {
  summary:"สรุปยอดขาย",payments:"ช่องทางชำระเงิน",products:"สินค้าขายดี",
  cashiers:"ประสิทธิภาพพนักงาน",sales:"รายการขาย",sale_row:"บิลขายที่เลือก",shift_row:"กะที่เลือก"
};
const activeButton = "rounded-lg border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50";
const outlineButton = "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-50";
const selectClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900";
const smallLabel = "mb-1 block text-xs font-bold text-slate-600";

export function SalesSummaryPrintDialog({
  target,payload,lang,onClose
}:{
  target:SalesPrintTarget;payload:PosSalesSummaryPayload;lang:Language;onClose:()=>void;
}) {
  const [kind,setKind]=useState<SalesPrintKind>(target.kind);
  const [period,setPeriod]=useState<Period>("filtered");
  const [day,setDay]=useState(payload.filters.dateTo);
  const [month,setMonth]=useState(payload.filters.dateTo.slice(0,7));
  const [year,setYear]=useState(payload.filters.dateTo.slice(0,4));
  const [rangeFrom,setRangeFrom]=useState(payload.filters.dateFrom);
  const [rangeTo,setRangeTo]=useState(payload.filters.dateTo);
  const [paper,setPaper]=useState<58|80>(80);
  const [html,setHtml]=useState("");
  const [preparedSignature,setPreparedSignature]=useState("");
  const [previewHash,setPreviewHash]=useState("");
  const [busy,setBusy]=useState(false);
  const [attempted,setAttempted]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const t=(thai:string,english:string,lao:string)=>lang==="th"?thai:lang==="lo"?lao:english;
  const isRow=target.kind==="sale_row"||target.kind==="shift_row";
  const signature=JSON.stringify({
    kind,rowId:target.rowId??null,paper,period,day,month,year,rangeFrom,rangeTo,
    appliedFilters:payload.filters
  });

  function reportFilters() {
    const filters={...payload.filters};
    if(period==="day"){
      filters.dateFrom=day;
      filters.dateTo=day;
    } else if(period==="month"){
      if(!/^\d{4}-\d{2}$/.test(month)) throw new Error("กรุณาเลือกเดือน");
      const y=Number(month.slice(0,4)),m=Number(month.slice(5,7));
      if(m<1||m>12) throw new Error("เดือนที่เลือกไม่ถูกต้อง");
      filters.dateFrom=month+"-01";
      filters.dateTo=month+"-"+String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,"0");
    } else if(period==="year"){
      if(!/^\d{4}$/.test(year)) throw new Error("กรุณาระบุปี ค.ศ. 4 หลัก");
      filters.dateFrom=year+"-01-01";
      filters.dateTo=year+"-12-31";
    } else if(period==="range"){
      filters.dateFrom=rangeFrom;
      filters.dateTo=rangeTo;
    }
    return filters;
  }
  async function preview() {
    if(busy)return;
    setBusy(true);setError("");setNotice("");setHtml("");setPreparedSignature("");setPreviewHash("");setAttempted(false);
    const current=signature;
    try{
      const response=await fetch("/api/pos/sales-summary/print",{
        method:"POST",credentials:"same-origin",cache:"no-store",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({mode:"preview",kind,paperWidthMm:paper,language:lang,rowId:target.rowId??null,filters:reportFilters()})
      });
      const json=await response.json().catch(()=>null) as ApiReply|null;
      if(!response.ok||!json?.data?.html||!json.data.previewHash)throw new Error(json?.error?.message??"สร้างตัวอย่างรายงานไม่สำเร็จ");
      setHtml(json.data.html);
      setPreviewHash(json.data.previewHash);
      setPreparedSignature(current);
    }catch(e){setError(e instanceof Error?e.message:"สร้างตัวอย่างรายงานไม่สำเร็จ")}
    finally{setBusy(false)}
  }
  async function confirm() {
    if(!html||!previewHash||preparedSignature!==signature||busy||attempted)return;
    setBusy(true);setAttempted(true);setError("");setNotice("");
    try{
      if(hasLocalWindowsPrintBridge()){
        // Explicit manual action only; local Windows spool acceptance is not proof of paper output.
        const result=await printWindowsReceiptHtml(html,{reprint:true});
        setNotice("Windows รับงานพิมพ์แล้ว ("+result.printer+") โปรดตรวจใบกระดาษจริง");
      }else{
        // Android / browser print agents must have a branch/device-scoped printer route.
        const response=await fetch("/api/pos/sales-summary/print",{
          method:"POST",credentials:"same-origin",cache:"no-store",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            mode:"queue",kind,paperWidthMm:paper,language:lang,
            rowId:target.rowId??null,filters:reportFilters(),previewHash,
            requestId:crypto.randomUUID()
          })
        });
        const json=await response.json().catch(()=>null) as ApiReply|null;
        if(!response.ok||json?.data?.queued!==true)throw new Error(json?.error?.message??"ไม่พบเครื่องพิมพ์ Android ที่เชื่อมต่อ");
        setNotice("ส่งเข้าคิวพิมพ์ Android/Print Agent แล้ว โปรดตรวจงานที่เครื่องพิมพ์");
      }
    }catch(e){
      setError((e instanceof Error?e.message:"ส่งงานพิมพ์ไม่สำเร็จ")
        +" — หากผลไม่แน่นอน กรุณาตรวจคิวก่อนสั่งพิมพ์ซ้ำ");
    }finally{setBusy(false)}
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-3" role="presentation">
      <section role="dialog" aria-modal="true" aria-label="พิมพ์สรุปยอดขาย"
        className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <h2 className="text-lg font-black">{t("ตัวอย่างและยืนยันพิมพ์ยอดขาย","Preview and confirm report","ຕົວຢ່າງແລະຢືນຢັນພິມ")}</h2>
          <button type="button" className={outlineButton} onClick={onClose}>{t("ปิด","Close","ປິດ")}</button>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label><span className={smallLabel}>{t("ประเภทรายงาน","Report type","ປະເພດລາຍງານ")}</span>
            <select className={selectClass} value={kind} disabled={isRow}
              onChange={e=>setKind(e.target.value as SalesPrintKind)}>
              {(Object.keys(kindNames) as SalesPrintKind[]).filter(x=>!x.endsWith("_row")||isRow&&x===target.kind)
                .map(x=><option key={x} value={x}>{kindNames[x]}</option>)}
            </select>
          </label>
          <label><span className={smallLabel}>{t("ช่วงรายงาน","Reporting period","ໄລຍະລາຍງານ")}</span>
            <select className={selectClass} value={period} onChange={e=>setPeriod(e.target.value as Period)}>
              <option value="filtered">{t("ตามตัวกรองที่ใช้","Applied filters","ຕາມຕົວກອງ")}</option>
              <option value="day">{t("รายวัน","Daily","ລາຍວັນ")}</option>
              <option value="month">{t("รายเดือน","Monthly","ລາຍເດືອນ")}</option>
              <option value="year">{t("รายปี","Yearly","ລາຍປີ")}</option>
              <option value="range">{t("กำหนดช่วงเอง","Custom dates","ເລືອກຊ່ວງ")}</option>
            </select>
          </label>
          <label><span className={smallLabel}>{t("กระดาษเครื่องพิมพ์","Printer paper","ເຈ້ຍພິມ")}</span>
            <select className={selectClass} value={paper} onChange={e=>setPaper(Number(e.target.value)===58?58:80)}>
              <option value={58}>58 mm</option><option value={80}>80 mm</option>
            </select>
          </label>
          {period==="day"?<label><span className={smallLabel}>วันที่</span><input type="date" className={selectClass} value={day} onChange={e=>setDay(e.target.value)}/></label>:null}
          {period==="month"?<label><span className={smallLabel}>เดือน</span><input type="month" className={selectClass} value={month} onChange={e=>setMonth(e.target.value)}/></label>:null}
          {period==="year"?<label><span className={smallLabel}>ปี ค.ศ.</span><input type="number" min={2000} max={2100} step={1} className={selectClass} value={year} onChange={e=>setYear(e.target.value)}/></label>:null}
          {period==="range"?<>
            <label><span className={smallLabel}>ตั้งแต่</span><input type="date" className={selectClass} value={rangeFrom} onChange={e=>setRangeFrom(e.target.value)}/></label>
            <label><span className={smallLabel}>ถึง</span><input type="date" className={selectClass} value={rangeTo} onChange={e=>setRangeTo(e.target.value)}/></label>
          </>:null}
        </div>
        <p className="mt-3 rounded-lg bg-blue-50 p-2 text-xs font-semibold text-blue-950">
          {t("พิมพ์เฉพาะข้อมูลที่มีสิทธิ์ตามสาขา/พนักงาน/ตัวกรอง และแยกสกุลเงินตามระบบ ไม่ใช่ใบกำกับภาษี",
             "Print only authorized filtered data; currencies remain separate. Not a tax receipt.",
             "ພິມຕາມສິດ ແລະ ຕົວກອງ; ບໍ່ແມ່ນໃບກຳກັບພາສີ")}
          {" · "+payload.currencyCode}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={outlineButton} disabled={busy} onClick={preview}>
            {busy?t("กำลังเตรียม...","Preparing...","ກຳລັງກະກຽມ..."):t("แสดงตัวอย่างก่อนพิมพ์","Show print preview","ເບິ່ງຕົວຢ່າງ")}
          </button>
        </div>
        {error?<p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p>:null}
        {notice?<p role="status" className="mt-3 rounded-lg border border-green-300 bg-green-50 p-3 text-sm font-bold text-green-900">{notice}</p>:null}
        {html&&preparedSignature===signature?
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-100 p-3">
            <p className="mb-2 text-sm font-bold text-slate-800">{t("ตัวอย่างใบสรุป","Report preview","ຕົວຢ່າງລາຍງານ")} ({paper} mm)</p>
            <div className="flex justify-center overflow-x-auto">
              <iframe title="Sales summary print preview" srcDoc={html} sandbox=""
                style={{width:(paper*3.78)+"px",height:Math.min(1280,Math.max(570,(html.match(/class="kv/g)?.length ?? 0)*31+260))+"px",background:"#fff",border:"1px solid #cbd5e1",boxShadow:"0 10px 30px rgba(15,23,42,.12)"}}/>
            </div>
          </div>:null}
        <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
          <button type="button" className={outlineButton} onClick={onClose}>{t("ปิด","Close","ປິດ")}</button>
          <button type="button" className={activeButton}
            disabled={busy||attempted||!html||!previewHash||preparedSignature!==signature} onClick={confirm}>
            {t("ยืนยันการพิมพ์","Confirm print","ຢືນຢັນການພິມ")}
          </button>
        </div>
        {attempted?<p className="mt-2 text-center text-xs font-semibold text-slate-500">
          {t("ส่งคำสั่งเพียงครั้งเดียว หากไม่ทราบผลให้ตรวจเครื่องก่อนสั่งใหม่","One attempt only. Check physical output before any retry.","ສົ່ງຄຳສັ່ງພຽງຄັ້ງດຽວ")}
        </p>:null}
      </section>
    </div>
  );
}
