"use client";

import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";
import type { PosBuffetPricePlan, PosBuffetPricingMode } from "@/lib/pos-buffet-pricing";

type SettingsPlan = PosBuffetPricePlan & {
  product_id?: string | null;
  configured?: boolean;
};

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
  const [savingMode, setSavingMode] = useState<PosBuffetPricingMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const planByMode = useMemo(() => new Map(plans.map((plan) => [plan.mode, plan])), [plans]);

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
      setInputs(Object.fromEntries(body.data.plans.map((plan) => [plan.mode, String(Number(plan.price || 0).toFixed(2))])));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : lang === "th" ? "ไม่สามารถโหลดราคาบุฟเฟ่ได้" : "Unable to load buffet prices.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // The workspace is branch-scoped by the authenticated POS session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(mode: PosBuffetPricingMode) {
    const raw = String(inputs[mode] ?? "").trim();
    const price = Number(raw);
    if (!Number.isFinite(price) || price <= 0) {
      setError(lang === "th" ? "กรุณาใส่ราคามากกว่า 0 บาท" : "Price must be greater than THB 0.");
      return;
    }

    setSavingMode(mode);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/pos/buffet-products/settings", {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ mode, price })
      });
      const body = (await response.json().catch(() => null)) as SettingsBody | null;
      const updated = body?.data?.plan;
      if (!response.ok || body?.error || !updated) {
        throw new Error(body?.error?.message ?? (lang === "th" ? "บันทึกราคาไม่สำเร็จ" : "Failed to save buffet price."));
      }
      setPlans((current) => current.map((plan) => (plan.mode === updated.mode ? updated : plan)));
      setInputs((current) => ({ ...current, [mode]: String(Number(updated.price || 0).toFixed(2)) }));
      setSuccess(
        lang === "th"
          ? `บันทึก ${updated.name} เป็น ${money(updated.price, lang)} แล้ว หน้าขายโหมดโต๊ะบุฟเฟ่จะใช้ราคานี้ทันที`
          : `${updated.name} is now ${money(updated.price, lang)}. Buffet Table sales will use this branch price.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : lang === "th" ? "บันทึกราคาไม่สำเร็จ" : "Failed to save buffet price.");
    } finally {
      setSavingMode(null);
    }
  }

  const displayOrder: PosBuffetPricingMode[] = ["per_person", "set"];

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
                  ? "กำหนดราคาของสาขานี้สำหรับหน้าขายโหมดโต๊ะบุฟเฟ่ โดยราคาที่บันทึกจะเป็นราคาอ้างอิงจริงของหน้าขาย"
                  : "Set this branch's prices for Buffet Table sales. Saved prices are the authoritative POS prices."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || savingMode !== null}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? (lang === "th" ? "กำลังโหลด..." : "Loading...") : lang === "th" ? "รีเฟรชราคา" : "Refresh"}
            </button>
          </div>
        </header>

        <div className="p-5 sm:p-6">
          <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
            {lang === "th"
              ? "ราคานี้เชื่อมกับสินค้าบุฟเฟ่ของสาขาโดยตรง การเปลี่ยนราคาจะมีผลกับรายการใหม่เท่านั้น และจะไม่เปลี่ยนยอดของบิลที่บันทึกไปแล้ว"
              : "These values update the branch buffet products directly. Changes affect new cart lines only and do not rewrite previously saved bills."}
          </div>

          {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}
          {success ? <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{success}</div> : null}

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left">
                <thead className="bg-slate-50 text-xs font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">{lang === "th" ? "ประเภทบุฟเฟ่" : "Buffet type"}</th>
                    <th className="px-5 py-3">{lang === "th" ? "หน่วยคิดราคา" : "Unit"}</th>
                    <th className="px-5 py-3">{lang === "th" ? "ราคาปัจจุบัน" : "Current price"}</th>
                    <th className="px-5 py-3">{lang === "th" ? "ราคาใหม่ (บาท)" : "New price (THB)"}</th>
                    <th className="px-5 py-3">{lang === "th" ? "สถานะ" : "Status"}</th>
                    <th className="px-5 py-3 text-right">{lang === "th" ? "บันทึก" : "Save"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {displayOrder.map((mode) => {
                    const plan = planByMode.get(mode);
                    if (!plan) {
                      return (
                        <tr key={mode}>
                          <td colSpan={6} className="px-5 py-5 text-sm font-semibold text-slate-400">
                            {loading ? (lang === "th" ? "กำลังโหลดข้อมูล..." : "Loading...") : lang === "th" ? "ไม่พบข้อมูลราคา" : "Price data unavailable"}
                          </td>
                        </tr>
                      );
                    }
                    const isSaving = savingMode === mode;
                    const inputPrice = Number(inputs[mode]);
                    const unchanged = Number.isFinite(inputPrice) && Number(inputPrice.toFixed(2)) === Number(Number(plan.price || 0).toFixed(2));
                    return (
                      <tr key={mode} className="align-middle">
                        <td className="px-5 py-4">
                          <div className="font-black text-slate-950">{plan.name}</div>
                          <div className="mt-1 text-xs font-semibold text-slate-400">{plan.code}</div>
                        </td>
                        <td className="px-5 py-4 text-sm font-bold text-slate-600">{unitLabel(mode, lang)}</td>
                        <td className="px-5 py-4 text-base font-black text-orange-600">{money(plan.price, lang)}</td>
                        <td className="px-5 py-4">
                          <div className="flex max-w-[190px] items-center rounded-lg border border-slate-200 bg-white focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
                            <span className="pl-3 text-sm font-black text-slate-400">฿</span>
                            <input
                              type="number"
                              min="0.01"
                              step="0.01"
                              inputMode="decimal"
                              value={inputs[mode] ?? ""}
                              disabled={loading || savingMode !== null}
                              onChange={(event) => {
                                setInputs((current) => ({ ...current, [mode]: event.target.value }));
                                setError(null);
                                setSuccess(null);
                              }}
                              className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-2.5 text-right text-base font-black text-slate-950 outline-none disabled:opacity-50"
                              aria-label={lang === "th" ? `ราคาใหม่ ${plan.name}` : `New price for ${plan.name}`}
                            />
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${
                              plan.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {plan.is_active
                              ? plan.configured
                                ? lang === "th" ? "ใช้งาน" : "Active"
                                : lang === "th" ? "ค่าเริ่มต้น" : "Default"
                              : lang === "th" ? "ปิดใช้งาน" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            onClick={() => void save(mode)}
                            disabled={loading || savingMode !== null || unchanged || !Number.isFinite(inputPrice) || inputPrice <= 0}
                            className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                          >
                            {isSaving ? (lang === "th" ? "กำลังบันทึก..." : "Saving...") : lang === "th" ? "บันทึกราคา" : "Save price"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-4 text-xs font-semibold leading-5 text-slate-500">
            {lang === "th"
              ? "หมายเหตุ: หน้านี้แก้เฉพาะราคา ไม่เปิดใช้งานสินค้าที่ถูกปิดไว้โดยอัตโนมัติ หากแพ็กเกจถูกปิดใช้งาน หน้าขายจะยังคงไม่อนุญาตให้เลือกแพ็กเกจนั้น"
              : "Note: this page changes price only. An inactive buffet product is never reactivated automatically and remains unavailable in the sales picker."}
          </p>
        </div>
      </section>
    </main>
  );
}
