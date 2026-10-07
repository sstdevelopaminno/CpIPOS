"use client";

import { useState } from "react";

const LINE_URL=process.env.NEXT_PUBLIC_CPIPOS_SUPPORT_LINE_URL||"https://lin.ee/f1LXpAF";

export function SubscriptionSupportButton({storeCode}:{storeCode:string}){
  const [busy,setBusy]=useState(false);
  async function openSupport(){
    setBusy(true);
    try{
      await fetch("/api/pos/subscription-support-request",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({message:"แพ็กเกจถูกล็อก/ต้องให้ IT ตรวจสอบ · รหัสร้าน "+storeCode})
      });
    }finally{
      setBusy(false);
      window.open(LINE_URL,"_blank","noopener,noreferrer");
    }
  }
  return <button type="button" onClick={()=>void openSupport()} disabled={busy}
    className="mt-3 inline-flex min-h-11 items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-red-700 disabled:opacity-60">
    {busy?"กำลังส่งข้อมูลให้ Support...":"เปิดแชท Support + แจ้ง IT"}
  </button>;
}
