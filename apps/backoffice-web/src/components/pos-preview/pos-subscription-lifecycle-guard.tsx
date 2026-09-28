"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PosSubscriptionLifecycleGuardData } from "@/lib/services/pos-subscription-lifecycle-guard-service";

type Envelope<T>={data?:T;error?:{code?:string;message?:string}};

function money(value:number|null,currency:string){
  return value==null ? "ยังไม่กำหนดราคา" :
    new Intl.NumberFormat("th-TH",{style:"currency",currency}).format(value);
}
function date(value:string|null){
  if(!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("th-TH",{dateStyle:"medium",timeZone:"Asia/Bangkok"}).format(new Date(value));
}
function daysRemaining(expiresAt:string|null,now:number){
  if(!expiresAt || !Number.isFinite(Date.parse(expiresAt))) return null;
  return Math.ceil((Date.parse(expiresAt)-now)/86400000);
}

export function PosSubscriptionLifecycleGuard({ initial }:{
  initial:PosSubscriptionLifecycleGuardData|null;
}) {
  const pathname=usePathname();
  const router=useRouter();
  const [runtime,setRuntime]=useState(initial);
  const [dismissed,setDismissed]=useState(false);
  const [clock,setClock]=useState(()=>Date.now());
  const refreshInFlight=useRef(false);
  const runtimeSignatureRef=useRef(initial
    ? [initial.lifecycle_status,initial.locked,initial.expires_at].join("|")
    : "");

  const refreshRuntime=useCallback(async(source:"realtime"|"push"|"focus"|"fallback")=>{
    if(refreshInFlight.current)return;
    refreshInFlight.current=true;
    try{
      const response=await fetch("/api/pos/billing/runtime",{cache:"no-store"});
      const json=await response.json().catch(()=>null) as Envelope<{runtime:PosSubscriptionLifecycleGuardData|null}>|null;
      if(!response.ok || !json?.data)return;
      const next=json.data.runtime;
      const signature=next ? [next.lifecycle_status,next.locked,next.expires_at].join("|") : "";
      const changed=signature!==runtimeSignatureRef.current;
      runtimeSignatureRef.current=signature;
      setRuntime(next);
      setClock(Date.now());
      setDismissed(false);
      window.dispatchEvent(new CustomEvent("cpipos-subscription-runtime-changed",{
        detail:{runtime:next,source}
      }));
      if(changed)router.refresh();
    }finally{
      refreshInFlight.current=false;
    }
  },[router]);

  useEffect(()=>{
    setRuntime(initial);
    runtimeSignatureRef.current=initial
      ? [initial.lifecycle_status,initial.locked,initial.expires_at].join("|")
      : "";
    setClock(Date.now());
  },[initial]);

  useEffect(()=>{
    const id=window.setInterval(()=>setClock(Date.now()),30_000);
    return()=>window.clearInterval(id);
  },[]);

  useEffect(()=>{
    if(!runtime?.tenant_id)return;
    let supabase:ReturnType<typeof getSupabaseBrowserClient>;
    try{supabase=getSupabaseBrowserClient();}catch{return;}
    const channel=supabase.channel(`subscription-runtime:${runtime.tenant_id}`)
      .on("postgres_changes",{
        event:"*",
        schema:"public",
        table:"tenant_subscription_runtime",
        filter:`tenant_id=eq.${runtime.tenant_id}`
      },()=>{void refreshRuntime("realtime");})
      .subscribe();
    return()=>{void supabase.removeChannel(channel);};
  },[runtime?.tenant_id,refreshRuntime]);

  useEffect(()=>{
    const onFocus=()=>void refreshRuntime("focus");
    const onOnline=()=>void refreshRuntime("focus");
    const onVisibility=()=>{if(document.visibilityState==="visible")void refreshRuntime("focus");};
    const onPush=(event:Event)=>{
      const payload=(event as CustomEvent<{kind?:string}>).detail;
      if(payload?.kind==="request")void refreshRuntime("push");
    };
    window.addEventListener("focus",onFocus);
    window.addEventListener("online",onOnline);
    document.addEventListener("visibilitychange",onVisibility);
    window.addEventListener("cpipos-pos-push-notification",onPush);
    const fallback=window.setInterval(()=>void refreshRuntime("fallback"),5*60_000);
    return()=>{
      window.removeEventListener("focus",onFocus);
      window.removeEventListener("online",onOnline);
      document.removeEventListener("visibilitychange",onVisibility);
      window.removeEventListener("cpipos-pos-push-notification",onPush);
      window.clearInterval(fallback);
    };
  },[refreshRuntime]);

  const computedDays=daysRemaining(runtime?.expires_at??null,clock);
  const expiredByClock=Boolean(runtime?.expires_at && Date.parse(runtime.expires_at)<=clock);
  const locked=Boolean(runtime && !runtime.exempt && (runtime.locked || expiredByClock));
  const paymentPage=pathname==="/preview/pos/payments/package";
  const showWarning=Boolean(runtime && !runtime.exempt && !locked && !paymentPage &&
    computedDays!==null && computedDays<=7 && computedDays>0 && !dismissed);
  const showLocked=Boolean(runtime && !runtime.exempt && locked && !paymentPage);
  const severity=useMemo(()=>{
    if(computedDays===null)return "normal";
    if(computedDays<=1)return "critical";
    if(computedDays<=3)return "high";
    return "warning";
  },[computedDays]);

  useEffect(()=>{
    if(!showWarning)return;
    try{
      const key="cpipos_subscription_warning_"+String(runtime?.expires_at||"unknown");
      if(window.sessionStorage.getItem(key)==="dismissed")setDismissed(true);
    }catch{}
  },[runtime?.expires_at,showWarning]);

  function dismiss(){
    setDismissed(true);
    try{
      const key="cpipos_subscription_warning_"+String(runtime?.expires_at||"unknown");
      window.sessionStorage.setItem(key,"dismissed");
    }catch{}
  }

  if(!runtime || runtime.exempt || (!showWarning && !showLocked))return null;
  const amount=money(runtime.amount_due,runtime.currency);
  const bankLine=[runtime.bank_name,runtime.account_name,runtime.account_number].filter(Boolean).join(" · ");

  if(showLocked){
    return <div className="fixed inset-0 z-[500] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <section role="alertdialog" aria-modal="true" aria-labelledby="subscription-locked-title"
        className="w-full max-w-xl overflow-hidden rounded-3xl border border-red-200 bg-white shadow-2xl">
        <div className="h-2 bg-red-500" />
        <div className="p-6 sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-red-600">SUBSCRIPTION PAYMENT REQUIRED</p>
          <h2 id="subscription-locked-title" className="mt-2 text-2xl font-black text-slate-950">แพ็กเกจครบกำหนดชำระแล้ว</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            ระบบงานขายถูกล็อกชั่วคราวจนกว่าฝ่าย IT จะตรวจสอบเงินเข้าและอนุมัติการต่ออายุ
            เมื่ออนุมัติแล้วหน้าจอนี้จะปลดล็อกอัตโนมัติ
          </p>
          <div className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
            <div><p className="text-xs text-slate-500">แพ็กเกจ</p><strong>{runtime.package_name}</strong></div>
            <div><p className="text-xs text-slate-500">ยอดที่ต้องชำระ</p><strong className="text-red-700">{amount}</strong></div>
            <div><p className="text-xs text-slate-500">ครบกำหนด</p><strong>{date(runtime.expires_at)}</strong></div>
            <div><p className="text-xs text-slate-500">รอบชำระ</p><strong>{runtime.billing_interval==="yearly"?"รายปี":"รายเดือน"}</strong></div>
          </div>
          {bankLine ? <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-900">
            บัญชีบริษัท: {bankLine}
          </p> : null}
          <p className="mt-3 text-xs leading-5 text-slate-500">
            เปิดเมนูชำระเงินเพื่อดูเลขบัญชี แนบสลิป และส่งแจ้งชำระให้ IT ตรวจสอบ
          </p>
          <button type="button" autoFocus
            onClick={()=>router.push("/preview/pos/payments/package")}
            className="mt-5 w-full rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-700">
            ชำระเงิน / แจ้งชำระเงิน
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
      <p className="mt-3 text-sm leading-6">เหลือ {computedDays} วัน · ครบกำหนด {date(runtime.expires_at)} · ยอด {amount}</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={()=>router.push("/preview/pos/payments/package")}
          className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white">ต่ออายุ / แจ้งชำระเงิน</button>
        <button type="button" onClick={dismiss}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">ไว้ภายหลัง</button>
      </div>
    </section>
  </div>;
}
