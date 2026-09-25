"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import type { PosSubscriptionCenterData } from "@/lib/services/pos-subscription-center-service";

type Tab = "overview" | "renew" | "notice" | "history" | "documents";
type Envelope<T> = { data?: T; error?: { code?: string; message?: string } };
const LABELS: Record<string,string> = {
  active:"ใช้งานอยู่",trial:"ทดลองใช้งาน",suspended:"ระงับบริการ",expired:"หมดอายุ",
  locked:"ถูกล็อกบริการ",cancelled:"ยกเลิกสัญญา",no_contract:"ยังไม่มีสัญญา",
  pending:"รอตรวจสอบ",under_review:"กำลังตรวจสอบ",approved:"อนุมัติแล้ว",
  rejected:"ปฏิเสธ",cancelled_request:"ยกเลิก"
};
const formatMoney = (number: number|null, currency="THB") => number == null ? "ยังไม่กำหนดราคา" :
  new Intl.NumberFormat("th-TH",{style:"currency",currency}).format(number);
const formatDate = (value:string|null) => value
  ? new Intl.DateTimeFormat("th-TH",{dateStyle:"medium",timeZone:"Asia/Bangkok"}).format(new Date(value)) : "—";
const tabs: Array<{key:Tab;name:string}> = [
  {key:"overview",name:"ภาพรวม"},{key:"renew",name:"ต่ออายุ / เปลี่ยนแพ็กเกจ"},
  {key:"notice",name:"แจ้งชำระเงิน"},{key:"history",name:"ประวัติ"},{key:"documents",name:"เอกสาร"}
];
const box = "rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_6px_24px_rgba(15,23,42,0.04)]";
const inputClass = "mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

function Stat({label,value,detail,highlight=false}:{label:string;value:string;detail?:string;highlight?:boolean}) {
  return <div className={box+" min-w-0"}>
    <p className="text-xs font-semibold tracking-wide text-slate-500">{label}</p>
    <strong className={"mt-2 block break-words text-xl font-extrabold "+(highlight?"text-blue-700":"text-slate-950")}>{value}</strong>
    {detail ? <p className="mt-1 text-xs text-slate-500">{detail}</p> : null}
  </div>;
}

export function PosSubscriptionCenter({initial,isOwner}:{initial:PosSubscriptionCenterData;isOwner:boolean}) {
  const [snapshot,setSnapshot] = useState(initial);
  const [tab,setTab] = useState<Tab>("overview");
  const [selectedPackage,setSelectedPackage] = useState(initial.contract.package_id || initial.packages[0]?.id || "");
  const [interval,setInterval] = useState(initial.contract.billing_interval==="yearly"?"yearly":"monthly");
  const [amount,setAmount] = useState("");
  const [payer,setPayer] = useState("");
  const [reference,setReference] = useState("");
  const [transferAt,setTransferAt] = useState("");
  const [note,setNote] = useState("");
  const [slip,setSlip] = useState<File|null>(null);
  const [lineOpen,setLineOpen] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [error,setError] = useState("");
  const [refreshing,setRefreshing] = useState(false);
  const requestKey = useRef<string|null>(null);
  const packageRow = useMemo(()=>snapshot.packages.find(p=>p.id===selectedPackage),[selectedPackage,snapshot.packages]);
  const due = packageRow?.id===snapshot.contract.package_id && interval===snapshot.contract.billing_interval
    ? snapshot.contract.amount_per_cycle
    : interval==="yearly" ? packageRow?.yearly_price ?? null : packageRow?.monthly_price ?? null;
  const pending = snapshot.requests.find(r=>r.status==="pending" || r.status==="under_review");
  const hasBank = Boolean(snapshot.issuer.account_number || snapshot.issuer.promptpay_id);
  const demo = snapshot.contract.is_internal_demo;
  const canSubmit = isOwner && !demo && !pending && !busy;
  const intervalLabel = snapshot.contract.billing_interval==="yearly" ? "รายปี" : "รายเดือน";

  function changed() {requestKey.current=null;setMessage("");setError("");}

  async function reload() {
    setRefreshing(true);
    try {
      const response=await fetch("/api/pos/billing/overview",{cache:"no-store"});
      const json=await response.json() as Envelope<PosSubscriptionCenterData>;
      if (!response.ok || !json.data) throw new Error(json.error?.message || "ไม่สามารถโหลดข้อมูลแพ็กเกจ");
      setSnapshot(json.data);
    } catch(cause) {
      setError(cause instanceof Error?cause.message:"โหลดข้อมูลไม่สำเร็จ");
    } finally {setRefreshing(false);}
  }

  async function submit(kind:"renewal_intent"|"payment_notice") {
    if (!canSubmit || !packageRow) return;
    if (kind==="payment_notice" && (!slip || !hasBank)) {
      setError("โปรดตรวจสอบบัญชีรับเงินและแนบสลิปก่อนส่ง");return;
    }
    if (!requestKey.current) requestKey.current=crypto.randomUUID();
    setBusy(true);setError("");setMessage("");
    const form=new FormData();
    form.set("request_key",requestKey.current);
    form.set("kind",kind);
    form.set("package_id",selectedPackage);
    form.set("billing_interval",interval);
    form.set("note",note);
    if(kind==="payment_notice"){
      form.set("amount_reported",amount);
      form.set("payer_name",payer);
      form.set("transfer_reference",reference);
      form.set("transfer_at",transferAt);
      if(slip) form.set("slip",slip);
    }
    try {
      const response=await fetch("/api/pos/billing/requests",{method:"POST",body:form});
      const json=await response.json() as Envelope<{id:string;status:string;already_submitted:boolean}>;
      if (!response.ok || !json.data) throw new Error(json.error?.message || "ส่งคำขอไม่สำเร็จ");
      requestKey.current=null;
      setMessage(kind==="payment_notice" ? "บันทึกการแจ้งชำระแล้ว กำลังรอตรวจสอบกับรายการรับเงินจริง" :
        "ส่งคำขอต่ออายุแล้ว กรุณารอฝ่าย IT ตรวจสอบรายละเอียด");
      setTab("history");
      await reload();
    } catch(cause) {setError(cause instanceof Error?cause.message:"ส่งคำขอไม่สำเร็จ");}
    finally {setBusy(false);}
  }

  return <section className="h-full w-full overflow-y-auto bg-[#f5f8fe] px-4 pb-12 pt-6 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-[1400px] space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-slate-200 bg-white px-6 py-6 shadow-sm">
        <div>
          <p className="text-xs font-black tracking-[0.16em] text-blue-600">CpIPOS · SUBSCRIPTION CENTER</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">แพ็กเกจและการชำระเงิน</h1>
          <p className="mt-2 text-sm text-slate-500">จัดการค่าบริการ CpIPOS ของร้านคุณ แยกจากการรับเงินขายสินค้าหน้าร้าน</p>
        </div>
        <button type="button" disabled={refreshing} onClick={()=>void reload()}
          className="rounded-xl border border-blue-200 px-4 py-2.5 text-sm font-bold text-blue-700 disabled:opacity-50">
          {refreshing?"กำลังอัปเดต...":"↻ รีเฟรชข้อมูล"}
        </button>
      </header>

      {error?<p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>:null}
      {message?<p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>:null}
      {pending?<p className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-medium text-amber-900">
        มีคำขอแพ็กเกจรอตรวจสอบอยู่แล้ว ({LABELS[pending.status] || pending.status}) · ส่งคำขอใหม่ได้หลังดำเนินการรายการเดิมเสร็จ
      </p>:null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-5">
          <div className="rounded-[22px] bg-gradient-to-r from-[#1749bc] to-[#2275ec] p-6 text-white shadow-[0_18px_35px_rgba(30,79,183,0.14)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><p className="text-xs font-bold text-blue-100">แพ็กเกจปัจจุบัน</p>
                <h2 className="mt-2 text-2xl font-black">{snapshot.contract.package_name}</h2>
                <p className="mt-1 text-sm text-blue-100">{snapshot.store.name} · {snapshot.store.code}</p>
              </div>
              <span className="rounded-full border border-white/25 bg-white/15 px-4 py-2 text-sm font-bold">
                {demo?"บัญชีทดสอบภายใน":LABELS[snapshot.contract.status]||snapshot.contract.status}
              </span>
            </div>
            <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 border-t border-white/20 pt-5 text-sm">
              <span>รอบบริการ <strong>{intervalLabel}</strong></span>
              <span>วันเริ่ม <strong>{formatDate(snapshot.contract.started_at)}</strong></span>
              <span>สิ้นสุด <strong>{demo?"ไม่มีการเรียกเก็บ":formatDate(snapshot.contract.expires_at)}</strong></span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat label="วันคงเหลือ" value={demo?"บัญชีภายใน":snapshot.contract.days_remaining===null?"ยังไม่กำหนด":
              snapshot.contract.days_remaining<0?"เกิน "+Math.abs(snapshot.contract.days_remaining)+" วัน":
              snapshot.contract.days_remaining+" วัน"} highlight />
            <Stat label="ค่าบริการต่อรอบ" value={demo?"ยกเว้นการเรียกเก็บ":snapshot.contract.package_code==="custom" && snapshot.contract.amount_per_cycle===null?"ตามสัญญา":formatMoney(snapshot.contract.amount_per_cycle,snapshot.contract.currency)}
              detail={demo?"ไม่ใช่ราคาแพ็กเกจลูกค้า":intervalLabel} />
            <Stat label="สิทธิ์การใช้งาน" value="สาขา · เครื่อง · ผู้ใช้"
              detail={[snapshot.contract.max_branches,snapshot.contract.max_devices,snapshot.contract.max_users]
                .map(x=>x===null?"ไม่จำกัด":String(x)).join(" / ")} />
          </div>

          <nav aria-label="เมนูแพ็กเกจ" className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2">
            {tabs.map(item=><button type="button" key={item.key} onClick={()=>{setTab(item.key);setError("");}}
              aria-current={tab===item.key?"page":undefined}
              className={"shrink-0 rounded-xl px-4 py-3 text-sm font-bold transition "+(tab===item.key?
                "bg-blue-600 text-white shadow-md":"text-slate-600 hover:bg-blue-50")}>{item.name}</button>)}
          </nav>

          {tab==="overview"? <div className={box+" space-y-4"}>
            <h3 className="text-lg font-black text-slate-900">ภาพรวมการใช้งาน</h3>
            <p className="text-sm leading-6 text-slate-600">ระบบอ่านสถานะแพ็กเกจล่าสุดจากฐานข้อมูลกลางของบริษัท ไม่มีการเปลี่ยนยอดขายหรือการปิดกะของร้าน</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label="รหัสร้าน" value={snapshot.store.code}/>
              <Stat label="ชื่อร้าน" value={snapshot.store.name}/>
              <Stat label="รอบชำระ" value={intervalLabel}/>
              <Stat label="สถานะบริการ" value={demo?"บัญชีทดสอบ":LABELS[snapshot.contract.status]||snapshot.contract.status}/>
            </div>
            <div className="flex flex-wrap gap-3 pt-2">
              <button type="button" onClick={()=>setTab("renew")} disabled={!isOwner||demo}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">ต่ออายุแพ็กเกจ</button>
              <button type="button" onClick={()=>setTab("notice")} disabled={!isOwner||demo}
                className="rounded-xl border border-blue-200 px-5 py-3 text-sm font-bold text-blue-700 disabled:opacity-50">แจ้งชำระเงิน</button>
            </div>
          </div>:null}

          {(tab==="renew"||tab==="notice")?<div className={box+" space-y-4"}>
            <div><p className="text-xs font-extrabold tracking-widest text-blue-600">{tab==="renew"?"RENEW SUBSCRIPTION":"PAYMENT NOTICE"}</p>
              <h3 className="mt-1 text-xl font-black text-slate-900">{tab==="renew"?"ต่ออายุ / เปลี่ยนแพ็กเกจ":"แจ้งชำระเงินด้วยสลิป"}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {tab==="renew"?"ส่งความประสงค์ให้ IT ตรวจสอบราคาและรอบบริการก่อนเปิดใช้สิทธิ์ใหม่":
                  "แจ้งรายการที่คุณโอนจริง โดย IT ต้องตรวจสอบการรับเงินจริงก่อนอนุมัติ"}</p>
            </div>
            {!isOwner?<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">เฉพาะเจ้าของร้านเท่านั้นที่ส่งคำขอแพ็กเกจได้</p>:null}
            {demo?<p className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900">บัญชีทดสอบภายในไม่ต้องต่ออายุหรือแจ้งชำระแพ็กเกจ</p>:null}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold text-slate-700">แพ็กเกจที่ต้องการ
                <select className={inputClass} disabled={!canSubmit} value={selectedPackage}
                  onChange={e=>{setSelectedPackage(e.target.value);changed();}}>
                  {snapshot.packages.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="text-sm font-bold text-slate-700">รอบชำระ
                <select className={inputClass} disabled={!canSubmit} value={interval}
                  onChange={e=>{setInterval(e.target.value);changed();}}>
                  <option value="monthly">รายเดือน</option>
                  <option value="yearly" disabled={!packageRow?.yearly_price && !(selectedPackage===snapshot.contract.package_id && snapshot.contract.billing_interval==="yearly" && snapshot.contract.amount_per_cycle)}>รายปี (เฉพาะแพ็กเกจที่ตั้งราคาแล้ว)</option>
                </select>
              </label>
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-xs font-bold text-blue-700">ราคาต่อรอบตามข้อมูลปัจจุบัน · รอ IT ยืนยัน</p>
              <strong className="mt-1 block text-2xl font-black text-slate-900">{packageRow?.contact_sales && due===null?"ตามสัญญา":formatMoney(due)}</strong>
              <p className="mt-1 text-xs text-slate-600">กรณี Custom หรือราคายังไม่กำหนด ให้สอบถาม IT ก่อนชำระ</p>
            </div>
            {tab==="notice"? <>
              {!hasBank?<p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">บริษัทยังไม่ได้ตั้งค่าบัญชีรับชำระ กรุณาติดต่อ Support ก่อนโอนเงิน</p>:null}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-bold text-slate-700">ยอดที่โอนจริง (บาท)
                  <input className={inputClass} type="number" inputMode="decimal" min="0.01" step="0.01" max="10000000"
                    value={amount} onChange={e=>{setAmount(e.target.value);changed();}} placeholder="0.00"/>
                </label>
                <label className="text-sm font-bold text-slate-700">วันและเวลาโอน
                  <input className={inputClass} type="datetime-local" value={transferAt}
                    onChange={e=>{setTransferAt(e.target.value);changed();}} />
                </label>
                <label className="text-sm font-bold text-slate-700">ชื่อผู้โอน
                  <input className={inputClass} maxLength={160} value={payer}
                    onChange={e=>{setPayer(e.target.value);changed();}} placeholder="ตามรายการโอน"/>
                </label>
                <label className="text-sm font-bold text-slate-700">เลขอ้างอิงธุรกรรม (ถ้ามี)
                  <input className={inputClass} maxLength={120} value={reference}
                    onChange={e=>{setReference(e.target.value);changed();}} placeholder="จากรายการธนาคาร"/>
                </label>
              </div>
              <label className="block text-sm font-bold text-slate-700">แนบสลิป (JPG, PNG, WebP หรือ PDF · ไม่เกิน 4 MB)
                <input className={inputClass} type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={e=>{setSlip(e.target.files?.[0]??null);changed();}} />
              </label>
            </>:null}
            <label className="block text-sm font-bold text-slate-700">หมายเหตุถึงฝ่าย IT
              <textarea className={inputClass} maxLength={500} rows={3} value={note}
                onChange={e=>{setNote(e.target.value);changed();}} placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)" />
            </label>
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              สลิปหรือการแจ้งชำระไม่ได้ยืนยันว่าเงินเข้าบัญชีแล้ว และไม่ต่ออายุหรือออกใบเสร็จอัตโนมัติ
              จนกว่าจะตรวจสอบรายการรับเงินจริง
            </p>
            <button type="button" disabled={!canSubmit||(tab==="notice"&&(!slip||!hasBank||!amount))}
              onClick={()=>void submit(tab==="renew"?"renewal_intent":"payment_notice")}
              className="w-full rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-100 disabled:cursor-not-allowed disabled:bg-slate-300">
              {busy?"กำลังส่งคำขอ...":tab==="renew"?"ส่งคำขอต่ออายุ":"ส่งแจ้งชำระเงิน"}
            </button>
          </div>:null}

          {tab==="history"?<div className={box+" space-y-6"}>
            <h3 className="text-lg font-black text-slate-900">ประวัติการแจ้งชำระและรอบบิล</h3>
            {snapshot.requests.length===0?<p className="text-sm text-slate-500">ยังไม่มีคำขอชำระแพ็กเกจของร้านนี้</p>:
              <div className="overflow-x-auto"><table className="min-w-[620px] w-full text-left text-sm">
                <thead className="text-slate-500"><tr>{["วันที่","ประเภท","ยอดที่แจ้ง","สถานะ","หลักฐาน / หมายเหตุ"].map(h=><th className="border-b p-3" key={h}>{h}</th>)}</tr></thead>
                <tbody>{snapshot.requests.map(row=><tr key={row.id} className="border-b">
                  <td className="p-3">{formatDate(row.submitted_at)}</td>
                  <td className="p-3">{row.kind==="payment_notice"?"แจ้งโอนเงิน":"ขอต่ออายุ"}</td>
                  <td className="p-3">{row.amount==null?"—":formatMoney(row.amount)}</td>
                  <td className="p-3 font-bold">{LABELS[row.status]||row.status}</td>
                  <td className="p-3">{row.has_evidence?"แนบหลักฐานแล้ว":"ไม่มีสลิป"}{row.review_note?" · "+row.review_note:""}</td>
                </tr>)}</tbody></table></div>}
            <h4 className="font-black text-slate-900">รอบบิลที่บันทึกแล้ว</h4>
            {snapshot.cycles.length===0?<p className="text-sm text-slate-500">ยังไม่มีรอบบิลที่บันทึกไว้</p>:
              <div className="overflow-x-auto"><table className="min-w-[600px] w-full text-left text-sm">
                <thead><tr>{["วันเริ่ม","วันสิ้นสุด","ยอดเรียกเก็บ","ยอดบันทึกชำระ","สถานะ"].map(h=><th className="border-b p-3" key={h}>{h}</th>)}</tr></thead>
                <tbody>{snapshot.cycles.map(c=><tr key={c.id} className="border-b">
                  <td className="p-3">{c.period_start}</td><td className="p-3">{c.period_end}</td>
                  <td className="p-3">{formatMoney(c.amount_due)}</td>
                  <td className="p-3">{formatMoney(c.amount_paid)}</td><td className="p-3">{c.status}</td>
                </tr>)}</tbody></table></div>}
          </div>:null}

          {tab==="documents"?<div className={box}>
            <h3 className="text-lg font-black text-slate-900">เอกสารแพ็กเกจ</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              ใบเสนอราคาและใบเสร็จเป็นเอกสารคนละประเภท ใบเสร็จจะเปิดให้ดาวน์โหลดเฉพาะเมื่อออกจากรายการรับเงินจริงที่ตรวจสอบแล้ว
            </p>
            <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              ยังไม่มีเอกสารแพ็กเกจที่ออกจริงสำหรับดาวน์โหลด
            </div>
            <p className="mt-3 text-xs text-slate-500">บริษัทไม่ได้จดทะเบียน VAT จึงไม่มีการออกใบกำกับภาษี VAT อัตโนมัติ</p>
          </div>:null}
        </main>

        <aside className="min-w-0 space-y-4">
          <div className={box+" space-y-3"}>
            <p className="text-xs font-black tracking-widest text-blue-600">COMPANY PAYMENT</p>
            <h3 className="text-lg font-black text-slate-950">บัญชีรับชำระของบริษัท</h3>
            <p className="text-sm text-slate-600">{snapshot.issuer.name}</p>
            {hasBank?<dl className="space-y-3 border-t border-slate-100 pt-4 text-sm">
              <div><dt className="text-xs text-slate-500">ธนาคาร</dt><dd className="font-bold text-slate-900">{snapshot.issuer.bank_name||"—"}</dd></div>
              <div><dt className="text-xs text-slate-500">ชื่อบัญชี</dt><dd className="font-bold text-slate-900">{snapshot.issuer.account_name||"—"}</dd></div>
              <div><dt className="text-xs text-slate-500">เลขบัญชี</dt><dd className="flex flex-wrap items-center gap-2 font-black text-blue-700">
                {snapshot.issuer.account_number||"—"}
                {snapshot.issuer.account_number?<button type="button" className="rounded-lg bg-blue-50 px-2 py-1 text-xs"
                  onClick={()=>void navigator.clipboard.writeText(snapshot.issuer.account_number)}>คัดลอก</button>:null}
              </dd></div>
              {snapshot.issuer.promptpay_id?<div><dt className="text-xs text-slate-500">พร้อมเพย์</dt><dd className="font-bold">{snapshot.issuer.promptpay_id}</dd></div>:null}
            </dl>:<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">ยังไม่ตั้งค่าบัญชีรับเงิน กรุณาติดต่อบริษัทก่อนชำระ</p>}
            <p className="text-xs leading-5 text-slate-500">บัญชีนี้สำหรับค่าแพ็กเกจ CpIPOS เท่านั้น ไม่ใช่บัญชีรับเงินขายสินค้าของร้าน</p>
          </div>

          <div className={box+" space-y-3"}>
            <p className="text-xs font-black tracking-widest text-blue-600">SUPPORT</p>
            <h3 className="text-lg font-black text-slate-950">ติดต่อบริษัท</h3>
            <a href="tel:0985460355" className="block rounded-xl bg-blue-600 px-4 py-3 text-center text-sm font-bold text-white">โทร. 0985460355</a>
            <a href={"mailto:"+snapshot.issuer.support_email} className="block break-all rounded-xl border border-blue-200 px-4 py-3 text-center text-sm font-bold text-blue-700">{snapshot.issuer.support_email}</a>
            <button type="button" aria-expanded={lineOpen} onClick={()=>setLineOpen(!lineOpen)}
              className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700">
              {lineOpen?"ซ่อน QR LINE ติดต่อ":"แสดง QR LINE ติดต่อ"}
            </button>
            {lineOpen?<Image src="/brand/line-company-qr.png" alt="QR LINE ติดต่อบริษัท (ไม่ใช่ QR รับเงิน)"
              width={440} height={440} className="mx-auto h-auto max-w-[220px] rounded-xl border border-slate-200" />:null}
            <p className="text-xs text-slate-500">QR LINE สำหรับติดต่อเท่านั้น ไม่ใช่ QR ชำระเงิน</p>
          </div>
        </aside>
      </div>
    </div>
  </section>;
}
