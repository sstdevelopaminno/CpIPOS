"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Language } from "@/lib/i18n";
import type { PosBuffetPricePlan, PosBuffetPricingMode } from "@/lib/pos-buffet-pricing";

type SettingsPlan = PosBuffetPricePlan;

type SettingsBody = {
  data?: {
    plans?: SettingsPlan[];
    plan?: SettingsPlan;
    branch_id?: string | null;
  } | null;
  error?: { code?: string; message?: string } | null;
};

function money(value: number, lang: Language) {
  return Number(value || 0).toLocaleString(lang === "th" ? "th-TH" : "en-US", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2
  });
}

function unitLabel(mode: PosBuffetPricingMode, lang: Language) {
  if (mode === "per_person") return lang === "th" ? "ต่อท่าน" : "per person";
  return lang === "th" ? "ต่อชุด" : "per set";
}

export function PosBuffetPriceSettingsWorkspace({ lang }: { lang: Language }) {
  const [plans, setPlans] = useState<SettingsPlan[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creatingMode, setCreatingMode] = useState<PosBuffetPricingMode | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function keyFor(plan: SettingsPlan) {
    return plan.product_id || plan.id;
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/buffet-products/settings", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const body = (await response.json().catch(() => null)) as SettingsBody | null;
      if (!response.ok || body?.error || !Array.isArray(body?.data?.plans)) {
        throw new Error(body?.error?.message ?? (lang === "th" ? "ไม่สามารถโหลดราคาบุฟเฟ่ได้" : "Unable to load buffet prices."));
      }
      setPlans(body.data.plans);
      setInputs(Object.fromEntries(body.data.plans.map((plan) => [keyFor(plan), plan.price > 0 ? String(Number(plan.price).toFixed(2)) : ""])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : lang === "th" ? "ไม่สามารถโหลดราคาบุฟเฟ่ได้" : "Unable to load buffet prices.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createPlan(mode: PosBuffetPricingMode) {
    setCreatingMode(mode);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/pos/buffet-products/settings", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ mode })
      });
      const body = (await response.json().catch(() => null)) as SettingsBody | null;
      const created = body?.data?.plan;
      if (!response.ok || body?.error || !created) {
        throw new Error(body?.error?.message ?? (lang === "th" ? "เพิ่มรายการบุฟเฟ่ไม่สำเร็จ" : "Failed to add buffet price row."));
      }
      setAddOpen(false);
      await load();
      setSuccess(lang === "th" ? `เพิ่ม ${created.name} แล้ว กรุณาใส่ราคาในตารางและกดบันทึก` : `${created.name} was added. Enter its price in the table and save.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : lang === "th" ? "เพิ่มรายการบุฟเฟ่ไม่สำเร็จ" : "Failed to add buffet price row.");
    } finally {
      setCreatingMode(null);
    }
  }

  async function save(plan: SettingsPlan) {
    const key = keyFor(plan);
    const price = Number(String(inputs[key] ?? "").trim());
    if (!Number.isFinite(price) || price <= 0) {
      setError(lang === "th" ? "กรุณาใส่ราคามากกว่า 0 บาท" : "Price must be greater than THB 0.");
      return;
    }

    setSavingId(key);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/pos/buffet-products/settings", {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: plan.product_id ?? null, mode: plan.mode, price })
      });
      const body = (await response.json().catch(() => null)) as SettingsBody | null;
      const updated = body?.data?.plan;
      if (!response.ok || body?.error || !updated) {
        throw new Error(body?.error?.message ?? (lang === "th" ? "บันทึกราคาไม่สำเร็จ" : "Failed to save buffet price."));
      }
      await load();
      setSuccess(
        lang === "th"
          ? `บันทึก ${updated.name} เป็น ${money(updated.price, lang)} แล้ว หน้าขายโต๊ะบุฟเฟ่จะแสดงรายการนี้ทันที`
          : `${updated.name} is now ${money(updated.price, lang)} and is available in Buffet Table sales.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : lang === "th" ? "บันทึกราคาไม่สำเร็จ" : "Failed to save buffet price.");
    } finally {
      setSavingId(null);
    }
  }

  const busy = loading || savingId !== null || creatingMode !== null;

  return (
    <main className="min-h-full bg-slate-50 p-3 sm:p-5">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">CpIPOS Buffet</p>
              <h1 className="mt-1 text-2xl font-black text-slate-950">{lang === "th" ? "ตั้งค่าราคาบุฟเฟ่" : "Buffet Price Settings"}</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                {lang === "th"
                  ? "เพิ่มราคาได้หลายรายการทั้งแบบรายท่านและแบบชุด ราคาที่เปิดใช้งานทั้งหมดจะแสดงในหน้าขายโต๊ะบุฟเฟ่"
                  : "Create multiple per-person and set prices. Every active price is shown in Buffet Table sales."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                disabled={busy}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
              >
                + {lang === "th" ? "เพิ่มรายการบุฟเฟ่" : "Add buffet price"}
              </button>
              <button
                type="button"
                onClick={() => void load()}
                disabled={busy}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {loading ? (lang === "th" ? "กำลังโหลด..." : "Loading...") : lang === "th" ? "รีเฟรชราคา" : "Refresh"}
              </button>
            </div>
          </div>
        </header>

        <div className="p-5 sm:p-6">
          <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
            {lang === "th"
              ? "รายการในตารางนี้คือ Source of Truth ของโหมดโต๊ะบุฟเฟ่ ปุ่ม “รายการ” ใช้กำหนดอาหารที่อยู่ในแพ็กเกจนั้น"
              : "This table is the Buffet Table source of truth. Use Items to define which foods belong to each package."}
          </div>

          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}
          {success ? <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{success}</div> : null}

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full border-collapse text-left">
                <thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">{lang === "th" ? "รายการบุฟเฟ่" : "Buffet plan"}</th>
                    <th className="px-5 py-3">{lang === "th" ? "ประเภท" : "Type"}</th>
                    <th className="px-5 py-3">{lang === "th" ? "ราคาปัจจุบัน" : "Current price"}</th>
                    <th className="px-5 py-3">{lang === "th" ? "ราคาใหม่ (บาท)" : "New price (THB)"}</th>
                    <th className="px-5 py-3">{lang === "th" ? "สถานะ" : "Status"}</th>
                    <th className="px-5 py-3 text-center">{lang === "th" ? "รายการ" : "Items"}</th>
                    <th className="px-5 py-3 text-right">{lang === "th" ? "บันทึก" : "Save"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {plans.map((plan) => {
                    const key = keyFor(plan);
                    const inputPrice = Number(inputs[key]);
                    const unchanged = Number.isFinite(inputPrice) && Number(inputPrice.toFixed(2)) === Number(Number(plan.price || 0).toFixed(2));
                    const isSaving = savingId === key;
                    return (
                      <tr key={key} className="align-middle">
                        <td className="px-5 py-4">
                          <div className="font-black text-slate-950">{plan.name}</div>
                          <div className="mt-1 text-xs font-semibold text-slate-400">{plan.code}</div>
                        </td>
                        <td className="px-5 py-4 text-sm font-bold text-slate-600">{unitLabel(plan.mode, lang)}</td>
                        <td className="px-5 py-4 text-base font-black text-orange-600">{plan.price > 0 ? money(plan.price, lang) : "-"}</td>
                        <td className="px-5 py-4">
                          <div className="flex max-w-[190px] items-center rounded-lg border border-slate-200 bg-white focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
                            <span className="pl-3 text-sm font-black text-slate-400">฿</span>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              inputMode="decimal"
                              value={inputs[key] ?? ""}
                              disabled={busy}
                              placeholder="0.00"
                              onChange={(event) => {
                                setInputs((current) => ({ ...current, [key]: event.target.value }));
                                setError(null);
                                setSuccess(null);
                              }}
                              className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-2.5 text-right text-base font-black text-slate-950 outline-none disabled:opacity-50"
                            />
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${plan.draft ? "bg-amber-50 text-amber-700" : plan.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                            {plan.draft
                              ? lang === "th" ? "รอตั้งราคา" : "Draft"
                              : plan.is_active
                                ? plan.configured ? lang === "th" ? "ใช้งาน" : "Active" : lang === "th" ? "ค่าเริ่มต้น" : "Default"
                                : lang === "th" ? "ปิดใช้งาน" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-center">
                          {plan.product_id ? (
                            <Link
                              href={`/preview/pos/stock/buffet-sets?plan=${encodeURIComponent(plan.product_id)}`}
                              prefetch={false}
                              className="inline-flex rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100"
                            >
                              {lang === "th" ? `รายการ (${plan.item_count ?? 0})` : `Items (${plan.item_count ?? 0})`}
                            </Link>
                          ) : (
                            <span className="text-xs font-semibold text-slate-400">{lang === "th" ? "บันทึกราคาก่อน" : "Save first"}</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => void save(plan)}
                            disabled={busy || (!plan.draft && unchanged) || !Number.isFinite(inputPrice) || inputPrice <= 0}
                            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                          >
                            {isSaving ? (lang === "th" ? "กำลังบันทึก..." : "Saving...") : lang === "th" ? "บันทึกราคา" : "Save price"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {plans.length === 0 && !loading ? (
                    <tr><td colSpan={7} className="px-5 py-8 text-center text-sm font-semibold text-slate-400">{lang === "th" ? "ยังไม่มีรายการบุฟเฟ่" : "No buffet plans."}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-4 text-xs font-semibold leading-5 text-slate-500">
            {lang === "th"
              ? "รายการใหม่จะยังไม่แสดงหน้าขายจนกว่าจะกำหนดราคาและกดบันทึก ส่วนรายการเดิมที่ถูกปิดใช้งานจะไม่ถูกเปิดกลับเองจากการแก้ราคา"
              : "New rows remain hidden from sales until a valid price is saved. Existing inactive plans are never reactivated merely by editing price."}
          </p>
        </div>
      </section>

      {addOpen ? (
        <div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/45 p-4" onClick={() => !busy && setAddOpen(false)}>
          <section className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">CpIPOS Buffet</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">{lang === "th" ? "เพิ่มรายการบุฟเฟ่" : "Add buffet price"}</h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">{lang === "th" ? "เลือกประเภทก่อน จากนั้นรายการใหม่จะลงในตารางเพื่อให้ใส่ราคา" : "Choose a type. A new row will be added for price entry."}</p>
              </div>
              <button type="button" disabled={busy} onClick={() => setAddOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-600">×</button>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button type="button" disabled={busy} onClick={() => void createPlan("per_person")} className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-left transition hover:bg-blue-100 disabled:opacity-50">
                <strong className="block text-lg font-black text-blue-950">{lang === "th" ? "บุฟเฟ่รายท่าน" : "Per-person"}</strong>
                <span className="mt-1 block text-sm font-semibold text-blue-700">{lang === "th" ? "คิดราคาตามจำนวนลูกค้า" : "Price by guest count"}</span>
                {creatingMode === "per_person" ? <span className="mt-3 block text-xs font-black text-blue-700">{lang === "th" ? "กำลังเพิ่ม..." : "Adding..."}</span> : null}
              </button>
              <button type="button" disabled={busy} onClick={() => void createPlan("set")} className="rounded-2xl border border-orange-200 bg-orange-50 p-5 text-left transition hover:bg-orange-100 disabled:opacity-50">
                <strong className="block text-lg font-black text-orange-950">{lang === "th" ? "บุฟเฟ่แบบชุด" : "Buffet set"}</strong>
                <span className="mt-1 block text-sm font-semibold text-orange-700">{lang === "th" ? "คิดราคาตามจำนวนชุด" : "Price by set count"}</span>
                {creatingMode === "set" ? <span className="mt-3 block text-xs font-black text-orange-700">{lang === "th" ? "กำลังเพิ่ม..." : "Adding..."}</span> : null}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
