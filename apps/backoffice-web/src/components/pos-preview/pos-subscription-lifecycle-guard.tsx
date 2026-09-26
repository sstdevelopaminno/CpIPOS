"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { PosSubscriptionLifecycleGuardData } from "@/lib/services/pos-subscription-lifecycle-guard-service";

function money(value:number|null,currency:string){
  return value==null ? "ยังไม่กำหนดราคา" :
    new Intl.NumberFormat("th-TH",{style:"currency",currency}).format(value);
}
function date(value:string|null){
  if(!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("th-TH",{dateStyle:"medium",timeZone:"Asia/Bangkok"}).format(new Date(value));
}

export function PosSubscriptionLifecycleGuard({ initial }:{
  initial:PosSubscriptionLifecycleGuardData|null;
}) {
  const pathname=usePathname();
  const router=useRouter();
  const [dismissed,setDismissed]=useState(false);
  const paymentPage=pathname==="/preview/pos/payments";
  const showWarning=Boolean(initial && !initial.exempt && !initial.locked &&
    initial.days_remaining!==null && initial.days_remaining<=7 && initial.days_remaining>0 && !dismissed);
  const showLocked=Boolean(initial && !initial.exempt && initial.locked && !paymentPage);
  const severity=useMemo(()=>{
    const days=initial?.days_remaining;
    if(days===null || days===undefined) return "normal";
    if(days<=1) return "critical";
    if(days<=3) return "high";
    return "warning";
  },[initial?.days_remaining]);

  useEffect(()=>{
    if(!showWarning) return;
    try{
      const key="cpipos_subscription_warning_"+String(initial?.expires_at||"unknown");
      if(window.sessionStorage.getItem(key)==="dismissed") setDismissed(true);
    }catch{}
  },[initial?.expires_at,showWarning]);

  function dismiss(){
    setDismissed(true);
    try{
      const key="cpipos_subscription_warning_"+String(initial?.expires_at||"unknown");
      window.sessionStorage.setItem(key,"dismissed");
    }catch{}
  }

  if(!initial || initial.exempt || (!showWarning && !showLocked)) return null;
  const amount=money(initial.amount_due,initial.currency);
  const bankLine=[initial.bank_name,initial.account_name,initial.account_number].filter(Boolean).join(" · ");

  if(showLocked){
    return <div className="fixed inset-0 z-[500] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <section role="alertdialog" aria-modal="true" aria-labelledby="subscription-locked-title"
        className="w-full max-w-xl overflow-hidden rounded-3xl border border-red-200 bg-white shadow-2xl">
        <div className="h-2 bg-red-500" />
        <div className="p-6 sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-600">SUBSCRIPTION PAYMENT REQUIRED</p>
          <h2 id="subscription-locked-title" className="mt-2 text-2xl font-black text-slate-950">แพ็กเกจครบกำหนดชำระแล้ว</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            ระบบงานขายถูกจำกัดชั่วคราวจนกว่าฝ่าย IT จะตรวจสอบเงินเข้าและอนุมัติการต่ออายุ
          </p>
          <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
            <div><p className="text-xs text-slate-500">แพ็กเกจ</p><strong>{initial.package_name}</strong></div>
            <div><p className="text-xs text-slate-500">ยอดที่ต้องชำระ</p><strong className="text-red-700">{amount}</strong></div>
            <div><p className="text-xs text-slate-500">ครบกำหนด</p><strong>{date(initial.expires_at)}</strong></div>
            <div><p className="text-xs text-slate-500">รอบชำระ</p><strong>{initial.billing_interval==="yearly"?"รายปี":"รายเดือน"}</strong></div>
          </div>
          {bankLine ? <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900">
            บัญชีบริษัท: {bankLine}
          </p> : null}
          <p className="mt-3 text-xs leading-5 text-slate-500">
            เมนูชำระเงินยังใช้งานได้เพื่อดูบัญชีบริษัท แนบสลิป และส่งแจ้งชำระให้ IT ตรวจสอบ
          </p>
          <button type="button" autoFocus
            onClick={()=>router.push("/preview/pos/payments")}
            className="mt-5 w-full rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-700">
            ไปที่เมนูชำระเงิน
          </button>
        </div>
      </section>
    </div>;
  }

  const tone=severity==="critical"?"border-red-200 bg-red-50 text-red-900":
    severity==="high"?"border-orange-200 bg-orange-50 text-orange-900":"border-amber-200 bg-amber-50 text-amber-900";
  return <div className="fixed inset-0 z-[450] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
    onMouseDown={(event)=>{if(event.target===event.currentTarget)dismiss();}}>
    <section role="dialog" aria-modal="true" aria-labelledby="subscription-warning-title"
      className={"w-full max-w-lg rounded-3xl border bg-white p-6 shadow-2xl "+tone}
      onMouseDown={(event)=>event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.15em]">PACKAGE RENEWAL REMINDER</p>
          <h2 id="subscription-warning-title" className="mt-2 text-xl font-black text-slate-950">แพ็กเกจใกล้ครบกำหนดชำระ</h2>
        </div>
        <button type="button" onClick={dismiss} aria-label="ปิด" className="h-9 w-9 rounded-full border border-current/20 bg-white/70 text-lg">×</button>
      </div>
      <p className="mt-3 text-sm leading-6">เหลือ {initial.days_remaining} วัน · ครบกำหนด {date(initial.expires_at)} · ยอด {amount}</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={()=>router.push("/preview/pos/payments")}
          className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white">ต่ออายุ / แจ้งชำระเงิน</button>
        <button type="button" onClick={dismiss}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">ไว้ภายหลัง</button>
      </div>
    </section>
  </div>;
}
