import {redirect} from "next/navigation";
import {requirePreEntrySupport} from "@/lib/server/preentry-support";
import {PosSupportChat} from "@/components/pos-preview/pos-support-chat";
export const dynamic="force-dynamic";
export default async function PreEntrySupportPage(){
 const identity=await requirePreEntrySupport().catch(()=>null);
 if(!identity)redirect("/login/store");
 return <main className="min-h-screen bg-slate-100 p-4 text-slate-800 sm:p-8">
  <div className="mx-auto max-w-5xl space-y-4">
    <a href="/login/devices" className="inline-block rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700">← กลับไปเลือกเครื่อง</a>
    <div className="rounded-2xl bg-white p-6 shadow">
      <h1 className="text-2xl font-black text-slate-800">ติดต่อฝ่าย IT Support</h1>
      <p className="mt-1 text-sm text-slate-600">{identity.storeName} · {identity.storeCode}</p>
      <p className="mt-2 text-sm text-slate-600">หากแพ็กเกจหมดอายุหรือยังไม่ผ่านการอนุมัติ คุณยังสามารถสนทนากับฝ่าย IT ได้</p>
      <PosSupportChat storeCode={identity.storeCode} storeName={identity.storeName}
        apiBase="/api/auth/support-chat" initiallyOpen/>
    </div>
  </div>
 </main>;
}
