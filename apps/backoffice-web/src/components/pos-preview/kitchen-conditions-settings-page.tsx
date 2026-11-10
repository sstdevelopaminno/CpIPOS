"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Language } from "@/lib/i18n";
import type { KitchenConditionsPolicy } from "@/lib/services/kitchen-conditions-service";

export function KitchenConditionsSettingsPage({ lang }: { lang: Language }) {
  const th = lang === "th";
  const [savedPolicy, setSavedPolicy] = useState<KitchenConditionsPolicy | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/pos/settings/kitchen-conditions", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok || !payload?.data?.policy) {
          throw new Error(String(payload?.error?.message ?? "Unable to load kitchen conditions"));
        }
        if (!active) return;
        const policy = payload.data.policy as KitchenConditionsPolicy;
        setSavedPolicy(policy);
        setEnabled(policy.lock_confirmed_items_on_pos);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load kitchen conditions");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function save() {
    if (!savedPolicy || saving || enabled === savedPolicy.lock_confirmed_items_on_pos) return;
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const response = await fetch("/api/pos/settings/kitchen-conditions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lock_confirmed_items_on_pos: enabled })
      });
      const payload = await response.json();
      if (!response.ok || !payload?.data?.policy) {
        throw new Error(String(payload?.error?.message ?? "Unable to save kitchen conditions"));
      }
      const policy = payload.data.policy as KitchenConditionsPolicy;
      setSavedPolicy(policy);
      setEnabled(policy.lock_confirmed_items_on_pos);
      setSuccess(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to save kitchen conditions");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="h-full min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4 md:p-7">
      <section className="mx-auto max-w-3xl space-y-5">
        <div>
          <Link href="/preview/pos/settings" className="text-sm font-semibold text-blue-600 hover:text-blue-700">
            ← {th ? "กลับไปเมนูตั้งค่า" : "Back to Settings"}
          </Link>
          <h1 className="mt-3 text-2xl font-black text-slate-950">
            {th ? "จัดการเงื่อนไขครัว" : "Kitchen Conditions"}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {th ? "ตั้งค่ากฎการทำงานของครัวสำหรับสาขาปัจจุบัน" : "Configure kitchen rules for the current branch."}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-bold text-slate-900">{th ? "เงื่อนไขที่ 1" : "Condition 1"}</h2>
          </div>
          <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl">
              <p id="kitchen-condition-title" className="text-base font-bold text-slate-950">
                {th ? "ห้ามหน้าขายลบหรือยกเลิกรายการหลังครัวยืนยัน" : "Prevent POS deletion after kitchen acknowledgement"}
              </p>
              <p id="kitchen-condition-description" className="mt-2 text-sm leading-6 text-slate-600">
                {th
                  ? "เมื่อครัวกดรับรายการแล้ว (รวมสถานะกำลังทำและพร้อมเสิร์ฟ) หน้าขายจะไม่สามารถลดจำนวน ลบรายการ หรือล้าง/ยกเลิกบิลที่มีรายการดังกล่าวได้ รายการที่ครัวยังไม่รับสามารถแก้ไขได้ตามปกติ"
                  : "After the kitchen acknowledges an item (including preparing and ready), the POS cannot reduce, remove, clear, or cancel that accepted item. Unacknowledged items remain editable."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-labelledby="kitchen-condition-title"
              aria-describedby="kitchen-condition-description"
              aria-checked={enabled}
              disabled={loading || saving || !savedPolicy}
              onClick={() => { setEnabled(value => !value); setSuccess(false); }}
              className={enabled
                ? "relative h-9 w-16 shrink-0 rounded-full bg-blue-600 transition disabled:opacity-50"
                : "relative h-9 w-16 shrink-0 rounded-full bg-slate-300 transition disabled:opacity-50"}
            >
              <span className={enabled
                ? "absolute left-8 top-1 h-7 w-7 rounded-full bg-white shadow transition"
                : "absolute left-1 top-1 h-7 w-7 rounded-full bg-white shadow transition"} />
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
            <span className="text-sm font-medium text-slate-600">
              {loading ? (th ? "กำลังโหลด..." : "Loading...")
                : enabled ? (th ? "เปิดใช้งาน" : "Enabled") : (th ? "ปิดใช้งาน" : "Disabled")}
            </span>
            <button
              type="button"
              disabled={loading || saving || !savedPolicy || enabled === savedPolicy.lock_confirmed_items_on_pos}
              onClick={() => void save()}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (th ? "กำลังบันทึก..." : "Saving...") : (th ? "บันทึกการตั้งค่า" : "Save settings")}
            </button>
          </div>
        </div>
        {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {success ? <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {th ? "บันทึกเงื่อนไขครัวเรียบร้อยแล้ว" : "Kitchen conditions saved."}
        </p> : null}
      </section>
    </main>
  );
}
