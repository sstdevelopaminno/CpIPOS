"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";
import type { PosBuffetPricePlan, PosBuffetPricingMode } from "@/lib/pos-buffet-pricing";

type SettingsPlan = PosBuffetPricePlan;
type SettingsBody = {
  data?: { plans?: SettingsPlan[]; plan?: SettingsPlan; branch_id?: string | null } | null;
  error?: { code?: string; message?: string } | null;
};
const PAGE_SIZE = 6;

function money(value: number, lang: Language) {
  return Number(value || 0).toLocaleString(lang === "th" ? "th-TH" : "en-US", { style: "currency", currency: "THB", minimumFractionDigits: 2 });
}
function unitLabel(mode: PosBuffetPricingMode, lang: Language) {
  return mode === "per_person" ? (lang === "th" ? "ต่อท่าน" : "per person") : (lang === "th" ? "ต่อชุด" : "per set");
}

export function PosBuffetPriceSettingsWorkspace({ lang }: { lang: Language }) {
  const [plans, setPlans] = useState<SettingsPlan[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creatingMode, setCreatingMode] = useState<PosBuffetPricingMode | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const keyFor = (plan: SettingsPlan) => plan.product_id || plan.id;
  const totalPages = Math.max(1, Math.ceil(plans.length / PAGE_SIZE));
  const pagePlans = useMemo(() => plans.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [page, plans]);

  async function load() {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/pos/buffet-products/settings", { method: "GET", credentials: "include", cache: "no-store", headers: { Accept: "application/json" } });
      const body = (await response.json().catch(() => null)) as SettingsBody | null;
      if (!response.ok || body?.error || !Array.isArray(body?.data?.plans)) throw new Error(body?.error?.message ?? (lang === "th" ? "ไม่สามารถโหลดราคาบุฟเฟ่ได้" : "Unable to load buffet prices."));
      setPlans(body.data.plans);
      setInputs(Object.fromEntries(body.data.plans.map((plan) => [keyFor(plan), plan.price > 0 ? String(Number(plan.price).toFixed(2)) : ""])));
      setPage((current) => Math.min(current, Math.max(1, Math.ceil(body.data!.plans!.length / PAGE_SIZE))));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load buffet prices."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function createPlan(mode: PosBuffetPricingMode) {
    setCreatingMode(mode); setError(null); setSuccess(null);
    try {
      const response = await fetch("/api/pos/buffet-products/settings", { method: "POST", credentials: "include", cache: "no-store", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
      const body = (await response.json().catch(() => null)) as SettingsBody | null;
      if (!response.ok || body?.error || !body?.data?.plan) throw new Error(body?.error?.message ?? "Failed to add buffet price row.");
      setAddOpen(false); await load(); setPage(Math.ceil((plans.length + 1) / PAGE_SIZE));
      setSuccess(lang === "th" ? `เพิ่ม ${body.data.plan.name} แล้ว กรุณาใส่ราคาและกดบันทึก` : `${body.data.plan.name} was added.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to add buffet price row."); }
    finally { setCreatingMode(null); }
  }

  async function save(plan: SettingsPlan) {
    const key = keyFor(plan); const price = Number(String(inputs[key] ?? "").trim());
    if (!Number.isFinite(price) || price <= 0) { setError(lang === "th" ? "กรุณาใส่ราคามากกว่า 0 บาท" : "Price must be greater than THB 0."); return; }
    setSavingId(key); setError(null); setSuccess(null);
    try {
      const response = await fetch("/api/pos/buffet-products/settings", { method: "PUT", credentials: "include", cache: "no-store", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ product_id: plan.product_id ?? null, mode: plan.mode, price }) });
      const body = (await response.json().catch(() => null)) as SettingsBody | null;
      if (!response.ok || body?.error || !body?.data?.plan) throw new Error(body?.error?.message ?? "Failed to save buffet price.");
      await load(); setSuccess(lang === "th" ? `บันทึก ${body.data.plan.name} เป็น ${money(body.data.plan.price, lang)} แล้ว` : `Saved ${body.data.plan.name}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to save buffet price."); }
    finally { setSavingId(null); }
  }

  async function remove(plan: SettingsPlan) {
    if (!plan.product_id) return;
    const confirmed = window.confirm(lang === "th" ? `ลบ ${plan.name} ออกจากรายการใช้งาน? ประวัติบิลเดิมจะยังคงอยู่` : `Remove ${plan.name}? Historical bills will remain.`);
    if (!confirmed) return;
    setDeletingId(plan.product_id); setError(null); setSuccess(null);
    try {
      const response = await fetch("/api/pos/buffet-products/settings", { method: "DELETE", credentials: "include", cache: "no-store", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ product_id: plan.product_id }) });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } | null } | null;
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? "Failed to remove buffet plan.");
      await load(); setSuccess(lang === "th" ? `ลบ ${plan.name} ออกจากรายการแล้ว ประวัติบิลเดิมไม่ถูกลบ` : `${plan.name} was archived.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Failed to remove buffet plan."); }
    finally { setDeletingId(null); }
  }

  const busy = loading || savingId !== null || deletingId !== null || creatingMode !== null;
  return (
    <main className="min-h-full bg-slate-50 p-3 sm:p-5">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">CpIPOS Buffet</p><h1 className="mt-1 text-2xl font-black text-slate-950">{lang === "th" ? "ตั้งค่าราคาบุฟเฟ่" : "Buffet Price Settings"}</h1><p className="mt-1 text-sm font-semibold text-slate-500">{lang === "th" ? "เพิ่มราคาได้หลายรายการทั้งแบบรายท่านและแบบชุด รายการที่เปิดใช้งานจะแสดงในหน้าขายโต๊ะบุฟเฟ่" : "Create multiple active buffet prices."}</p></div>
            <div className="flex gap-2"><button type="button" onClick={() => setAddOpen(true)} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white">+ {lang === "th" ? "เพิ่มรายการบุฟเฟ่" : "Add buffet price"}</button><button type="button" onClick={() => void load()} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700">{lang === "th" ? "รีเฟรชราคา" : "Refresh"}</button></div>
          </div>
        </header>
        <div className="p-5 sm:p-6">
          <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">{lang === "th" ? "รายการในตารางนี้คือ Source of Truth ของโหมดโต๊ะบุฟเฟ่ ปุ่ม “รายการ” ใช้กำหนดอาหารในแพ็กเกจนั้น" : "This table is the Buffet source of truth."}</div>
          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}
          {success ? <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{success}</div> : null}
          <div className="overflow-hidden rounded-xl border border-slate-200"><div className="overflow-x-auto"><table className="w-full min-w-[1040px] border-collapse text-left">
            <thead className="bg-slate-50 text-xs font-black text-slate-500"><tr><th className="px-5 py-3">{lang === "th" ? "รายการบุฟเฟ่" : "Buffet plan"}</th><th className="px-5 py-3">{lang === "th" ? "ประเภท" : "Type"}</th><th className="px-5 py-3">{lang === "th" ? "ราคาปัจจุบัน" : "Current price"}</th><th className="px-5 py-3">{lang === "th" ? "ราคาใหม่ (บาท)" : "New price"}</th><th className="px-5 py-3">{lang === "th" ? "สถานะ" : "Status"}</th><th className="px-5 py-3 text-center">{lang === "th" ? "รายการ" : "Items"}</th><th className="px-5 py-3 text-right">{lang === "th" ? "บันทึก" : "Save"}</th><th className="px-5 py-3 text-right">{lang === "th" ? "ลบ" : "Remove"}</th></tr></thead>
            <tbody className="divide-y divide-slate-200 bg-white">{pagePlans.map((plan) => { const key=keyFor(plan); const inputPrice=Number(inputs[key]); const unchanged=Number.isFinite(inputPrice)&&Number(inputPrice.toFixed(2))===Number(Number(plan.price||0).toFixed(2)); return <tr key={key}>
              <td className="px-5 py-4"><div className="font-black text-slate-950">{plan.name}</div><div className="mt-1 text-xs font-semibold text-slate-400">{plan.code}</div></td><td className="px-5 py-4 text-sm font-bold text-slate-600">{unitLabel(plan.mode,lang)}</td><td className="px-5 py-4 font-black text-orange-600">{plan.price>0?money(plan.price,lang):"-"}</td>
              <td className="px-5 py-4"><div className="flex max-w-[190px] items-center rounded-lg border border-slate-200"><span className="pl-3 font-black text-slate-400">฿</span><input type="number" min="0.01" step="0.01" value={inputs[key]??""} disabled={busy} onChange={(e)=>setInputs((c)=>({...c,[key]:e.target.value}))} className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-2.5 text-right font-black outline-none" /></div></td>
              <td className="px-5 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${plan.draft?"bg-amber-50 text-amber-700":plan.is_active?"bg-emerald-50 text-emerald-700":"bg-slate-100 text-slate-500"}`}>{plan.draft?(lang==="th"?"รอตั้งราคา":"Draft"):plan.is_active?(plan.configured?(lang==="th"?"ใช้งาน":"Active"):(lang==="th"?"ค่าเริ่มต้น":"Default")):(lang==="th"?"ปิดใช้งาน":"Inactive")}</span></td>
              <td className="px-5 py-4 text-center">{plan.product_id?<Link href={`/preview/pos/stock/buffet-sets?plan=${encodeURIComponent(plan.product_id)}`} prefetch={false} className="inline-flex rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">{lang==="th"?`รายการ (${plan.item_count??0})`:`Items (${plan.item_count??0})`}</Link>:<span className="text-xs font-semibold text-slate-400">{lang==="th"?"บันทึกราคาก่อน":"Save first"}</span>}</td>
              <td className="px-5 py-4 text-right"><button type="button" onClick={()=>void save(plan)} disabled={busy||(!plan.draft&&unchanged)||!Number.isFinite(inputPrice)||inputPrice<=0} className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-black text-white disabled:bg-slate-200 disabled:text-slate-400">{savingId===key?(lang==="th"?"กำลังบันทึก...":"Saving..."):(lang==="th"?"บันทึกราคา":"Save")}</button></td>
              <td className="px-5 py-4 text-right">{plan.product_id?<button type="button" onClick={()=>void remove(plan)} disabled={busy} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-black text-red-700 hover:bg-red-100">{deletingId===plan.product_id?(lang==="th"?"กำลังลบ...":"Removing..."):(lang==="th"?"ลบรายการ":"Remove")}</button>:<span className="text-xs text-slate-300">-</span>}</td>
            </tr>; })}{plans.length===0&&!loading?<tr><td colSpan={8} className="px-5 py-8 text-center text-sm font-semibold text-slate-400">{lang==="th"?"ยังไม่มีรายการบุฟเฟ่":"No buffet plans."}</td></tr>:null}</tbody>
          </table></div></div>
          {totalPages>1?<div className="mt-4 flex items-center justify-end gap-2"><button type="button" disabled={page<=1||busy} onClick={()=>setPage((p)=>Math.max(1,p-1))} className="rounded-lg border px-3 py-2 text-sm font-black disabled:opacity-40">{lang==="th"?"ก่อนหน้า":"Previous"}</button><span className="px-2 text-sm font-bold text-slate-500">{lang==="th"?`หน้า ${page} จาก ${totalPages}`:`Page ${page} of ${totalPages}`}</span><button type="button" disabled={page>=totalPages||busy} onClick={()=>setPage((p)=>Math.min(totalPages,p+1))} className="rounded-lg border px-3 py-2 text-sm font-black disabled:opacity-40">{lang==="th"?"ถัดไป":"Next"}</button></div>:null}
        </div>
      </section>
      {addOpen?<div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/45 p-4" onClick={()=>!busy&&setAddOpen(false)}><section className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl" onClick={(e)=>e.stopPropagation()}><div className="flex justify-between"><div><p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">CpIPOS Buffet</p><h2 className="mt-1 text-xl font-black">{lang==="th"?"เพิ่มรายการบุฟเฟ่":"Add buffet price"}</h2></div><button type="button" onClick={()=>setAddOpen(false)} className="rounded-lg border px-3 py-2">×</button></div><div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" disabled={busy} onClick={()=>void createPlan("per_person")} className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-left"><strong>{lang==="th"?"บุฟเฟ่รายท่าน":"Per-person"}</strong></button><button type="button" disabled={busy} onClick={()=>void createPlan("set")} className="rounded-2xl border border-orange-200 bg-orange-50 p-5 text-left"><strong>{lang==="th"?"บุฟเฟ่แบบชุด":"Buffet set"}</strong></button></div></section></div>:null}
    </main>
  );
}
