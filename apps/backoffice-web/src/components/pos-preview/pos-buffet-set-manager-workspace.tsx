"use client";

import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";
import type { PosBuffetPricePlan } from "@/lib/pos-buffet-pricing";

type FoodItem = {
  id: string;
  sku: string | null;
  name: string;
  category: string;
  price: number;
};

type ItemsBody = {
  data?: {
    plans?: PosBuffetPricePlan[];
    products?: FoodItem[];
    selected_product_ids?: string[];
    item_count?: number;
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

export function PosBuffetSetManagerWorkspace({ lang, initialPlanId = "" }: { lang: Language; initialPlanId?: string }) {
  const [plans, setPlans] = useState<PosBuffetPricePlan[]>([]);
  const [products, setProducts] = useState<FoodItem[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState(initialPlanId);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(Boolean(initialPlanId));
  const [step, setStep] = useState<"plan" | "items">(initialPlanId ? "items" : "plan");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const setPlans = useMemo(() => plans.filter((plan) => plan.mode === "set" && plan.is_active && plan.price > 0), [plans]);
  const selectedPlan = plans.find((plan) => plan.product_id === selectedPlanId || plan.id === selectedPlanId) ?? null;
  const filteredProducts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return products;
    return products.filter((item) => `${item.name} ${item.sku ?? ""} ${item.category}`.toLowerCase().includes(keyword));
  }, [products, search]);

  async function load(planId = "") {
    setLoading(true);
    setError(null);
    try {
      const suffix = planId ? `?plan_id=${encodeURIComponent(planId)}` : "";
      const response = await fetch(`/api/pos/buffet-products/items${suffix}`, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const body = (await response.json().catch(() => null)) as ItemsBody | null;
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? "Failed to load buffet set data.");
      setPlans(Array.isArray(body?.data?.plans) ? body!.data!.plans! : []);
      setProducts(Array.isArray(body?.data?.products) ? body!.data!.products! : []);
      if (planId) setCheckedIds(Array.isArray(body?.data?.selected_product_ids) ? body!.data!.selected_product_ids! : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : lang === "th" ? "โหลดข้อมูลไม่สำเร็จ" : "Unable to load data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(initialPlanId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPlanId]);

  async function choosePlan(plan: PosBuffetPricePlan) {
    const planId = String(plan.product_id ?? plan.id);
    setSelectedPlanId(planId);
    setCheckedIds([]);
    setSearch("");
    setStep("items");
    await load(planId);
  }

  function openAddSet() {
    setSelectedPlanId("");
    setCheckedIds([]);
    setSearch("");
    setError(null);
    setSuccess(null);
    setStep("plan");
    setModalOpen(true);
  }

  async function openExisting(plan: PosBuffetPricePlan) {
    setModalOpen(true);
    setStep("items");
    setSuccess(null);
    await choosePlan(plan);
  }

  function toggleProduct(productId: string) {
    setCheckedIds((current) => current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId]);
  }

  async function saveItems() {
    if (!selectedPlanId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/pos/buffet-products/items", {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ plan_id: selectedPlanId, product_ids: checkedIds })
      });
      const body = (await response.json().catch(() => null)) as ItemsBody | null;
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? "Failed to save buffet set items.");
      setSuccess(
        lang === "th"
          ? `บันทึกรายการอาหาร ${checkedIds.length} รายการใน ${selectedPlan?.name ?? "ชุดบุฟเฟ่"} แล้ว`
          : `Saved ${checkedIds.length} item(s) in ${selectedPlan?.name ?? "buffet set"}.`
      );
      setModalOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : lang === "th" ? "บันทึกรายการไม่สำเร็จ" : "Failed to save items.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-full bg-slate-50 p-3 sm:p-5">
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="border-b border-slate-200 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">CpIPOS Buffet Catalog</p>
              <h1 className="mt-1 text-2xl font-black text-slate-950">{lang === "th" ? "จัดชุดบุฟเฟ่" : "Buffet Set Manager"}</h1>
              <p className="mt-1 text-sm font-semibold text-slate-500">
                {lang === "th"
                  ? "เลือกแพ็กเกจบุฟเฟ่แบบชุดจากราคาที่ตั้งไว้ แล้วกำหนดรายการอาหารที่ลูกค้าสามารถสั่งในชุดนั้น"
                  : "Choose a configured buffet set price and define which menu items belong to that set."}
              </p>
            </div>
            <button type="button" onClick={openAddSet} disabled={loading || saving || setPlans.length === 0} className="rounded-lg bg-orange-500 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-orange-600 disabled:opacity-50">
              + {lang === "th" ? "เพิ่มชุดบุฟเฟ่" : "Add buffet set"}
            </button>
          </div>
        </header>

        <div className="p-5 sm:p-6">
          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}
          {success ? <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{success}</div> : null}

          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-sm font-bold text-slate-500">{lang === "th" ? "กำลังโหลดชุดบุฟเฟ่..." : "Loading buffet sets..."}</div>
          ) : setPlans.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm font-bold text-amber-800">
              {lang === "th" ? "ยังไม่มีราคาบุฟเฟ่แบบชุดที่เปิดใช้งาน กรุณาไป เพิ่มเติม → ตั้งค่าราคาบุฟเฟ่ แล้วเพิ่ม/บันทึกราคาแบบชุดก่อน" : "No active buffet set price exists. Add one in More → Buffet Price Settings first."}
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {setPlans.map((plan) => (
                <button key={plan.id} type="button" onClick={() => void openExisting(plan)} className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-orange-300 hover:bg-orange-50/50">
                  <span className="text-xs font-black uppercase tracking-wide text-orange-600">{lang === "th" ? "บุฟเฟ่แบบชุด" : "Buffet set"}</span>
                  <strong className="mt-2 block text-lg font-black text-slate-950">{plan.name}</strong>
                  <span className="mt-3 block text-2xl font-black text-orange-600">{money(plan.price, lang)}</span>
                  <span className="mt-4 inline-flex rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-600">{lang === "th" ? "จัดการรายการอาหาร" : "Manage items"}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-[190] grid place-items-center bg-slate-950/50 p-4" onClick={() => !saving && setModalOpen(false)}>
          <section className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-600">CpIPOS Buffet</p>
                <h2 className="mt-1 text-xl font-black text-slate-950">
                  {step === "plan" ? (lang === "th" ? "เพิ่มชุดบุฟเฟ่" : "Add buffet set") : selectedPlan?.name ?? (lang === "th" ? "เลือกรายการอาหาร" : "Choose menu items")}
                </h2>
                <p className="mt-1 text-sm font-semibold text-slate-500">
                  {step === "plan"
                    ? (lang === "th" ? "เลือกราคาบุฟเฟ่แบบชุดจากหน้าตั้งค่าราคา" : "Choose a set price from Buffet Price Settings.")
                    : (lang === "th" ? "ติ๊กรายการอาหารที่ต้องการให้อยู่ในชุดนี้" : "Check the menu items included in this set.")}
                </p>
              </div>
              <button type="button" disabled={saving} onClick={() => setModalOpen(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-600">×</button>
            </header>

            {step === "plan" ? (
              <div className="grid gap-3 overflow-y-auto p-5 sm:grid-cols-2">
                {setPlans.map((plan) => (
                  <button key={plan.id} type="button" onClick={() => void choosePlan(plan)} className="rounded-2xl border border-slate-200 p-5 text-left hover:border-orange-300 hover:bg-orange-50">
                    <strong className="block text-lg font-black text-slate-950">{plan.name}</strong>
                    <span className="mt-2 block text-2xl font-black text-orange-600">{money(plan.price, lang)}</span>
                    <small className="mt-2 block font-bold text-slate-400">{plan.code}</small>
                  </button>
                ))}
              </div>
            ) : (
              <>
                <div className="border-b border-slate-100 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={lang === "th" ? "ค้นหาชื่ออาหาร / SKU / หมวดหมู่..." : "Search food / SKU / category..."} className="min-h-10 min-w-[260px] flex-1 rounded-lg border border-slate-300 px-3 text-sm font-semibold" />
                    <span className="rounded-full bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">{lang === "th" ? `เลือกแล้ว ${checkedIds.length} รายการ` : `${checkedIds.length} selected`}</span>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <div className="overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full min-w-[680px] border-collapse text-left">
                      <thead className="sticky top-0 bg-slate-50 text-xs font-black text-slate-500">
                        <tr><th className="px-4 py-3">✓</th><th className="px-4 py-3">{lang === "th" ? "สินค้า" : "Product"}</th><th className="px-4 py-3">SKU</th><th className="px-4 py-3">{lang === "th" ? "หมวดหมู่" : "Category"}</th><th className="px-4 py-3 text-right">{lang === "th" ? "ราคาปกติ" : "Normal price"}</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredProducts.map((item) => (
                          <tr key={item.id} className={checkedIds.includes(item.id) ? "bg-blue-50/60" : "bg-white"}>
                            <td className="px-4 py-3"><input type="checkbox" checked={checkedIds.includes(item.id)} onChange={() => toggleProduct(item.id)} className="h-5 w-5 rounded border-slate-300" /></td>
                            <td className="px-4 py-3 font-black text-slate-900">{item.name}</td>
                            <td className="px-4 py-3 text-xs font-bold text-slate-500">{item.sku ?? "-"}</td>
                            <td className="px-4 py-3 text-sm font-semibold text-slate-600">{item.category || "-"}</td>
                            <td className="px-4 py-3 text-right text-sm font-black text-slate-800">{money(item.price, lang)}</td>
                          </tr>
                        ))}
                        {filteredProducts.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-sm font-semibold text-slate-400">{lang === "th" ? "ไม่พบรายการอาหาร" : "No menu items found."}</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </div>
                <footer className="flex flex-wrap justify-between gap-3 border-t border-slate-200 p-4">
                  <button type="button" disabled={saving} onClick={() => setStep("plan")} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700">{lang === "th" ? "ย้อนกลับเลือกราคา" : "Back to price"}</button>
                  <button type="button" disabled={saving || !selectedPlanId} onClick={() => void saveItems()} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-50">{saving ? (lang === "th" ? "กำลังบันทึก..." : "Saving...") : lang === "th" ? `บันทึกรายการ (${checkedIds.length})` : `Save items (${checkedIds.length})`}</button>
                </footer>
              </>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
