"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";

type OverrideMode = "inherit" | "force_on" | "force_off";
type Policy = {
  branch_id: string;
  cashier_review_required: boolean;
  kitchen_alert: { popup_enabled: boolean; sound_enabled: boolean; sound_volume: number };
  store: {
    popup_enabled: boolean;
    kitchen_auto_send_enabled: boolean;
    kitchen_auto_print_enabled: boolean;
  };
  override: {
    popup: OverrideMode;
    kitchen_auto_send: OverrideMode;
    kitchen_auto_print: OverrideMode;
  };
  effective: {
    popup_enabled: boolean;
    kitchen_auto_send_enabled: boolean;
    kitchen_auto_print_enabled: boolean;
  };
  forced_by_it: {
    popup: boolean;
    kitchen_auto_send: boolean;
    kitchen_auto_print: boolean;
  };
};

type SwitchRowProps = {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  forcedLabel?: string;
  onChange: (checked: boolean) => void;
};

function SwitchRow({ title, description, checked, disabled = false, forcedLabel, onChange }: SwitchRowProps) {
  return (
    <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 pr-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-base font-black text-slate-950">{title}</p>
          {forcedLabel ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">{forcedLabel}</span> : null}
        </div>
        <p className="mt-1 text-sm font-medium leading-6 text-slate-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 shrink-0 rounded-full transition ${checked ? "bg-blue-600" : "bg-slate-300"} ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
      >
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${checked ? "left-7" : "left-1"}`} />
      </button>
    </div>
  );
}

export function OrderKitchenSettingsPage({ lang }: { lang: Language }) {
  const th = lang === "th";
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy["store"] | null>(null);
  const [kitchenAlertDraft, setKitchenAlertDraft] = useState<Policy["kitchen_alert"] | null>(null);
  const [cashierReviewDraft, setCashierReviewDraft] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/pos/settings/order-kitchen", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(payload?.error?.message ?? payload?.message ?? "Load failed"));
        if (!active) return;
        const next = payload?.data?.policy as Policy;
        setPolicy(next);
        setDraft(next.store);
        setKitchenAlertDraft(next.kitchen_alert);
        setCashierReviewDraft(next.cashier_review_required);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Load failed");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const dirty = useMemo(() => {
    if (!policy || !draft || !kitchenAlertDraft || cashierReviewDraft === null) return false;
    return cashierReviewDraft !== policy.cashier_review_required
      || draft.popup_enabled !== policy.store.popup_enabled
      || draft.kitchen_auto_send_enabled !== policy.store.kitchen_auto_send_enabled
      || draft.kitchen_auto_print_enabled !== policy.store.kitchen_auto_print_enabled
      || kitchenAlertDraft.popup_enabled !== policy.kitchen_alert.popup_enabled
      || kitchenAlertDraft.sound_enabled !== policy.kitchen_alert.sound_enabled
      || kitchenAlertDraft.sound_volume !== policy.kitchen_alert.sound_volume;
  }, [cashierReviewDraft, draft, kitchenAlertDraft, policy]);

  function shown(key: keyof Policy["store"], effectiveKey: keyof Policy["effective"], forced: boolean) {
    if (!policy || !draft) return false;
    return forced ? policy.effective[effectiveKey] : draft[key];
  }

  async function save() {
    if (!draft || !policy || !kitchenAlertDraft || cashierReviewDraft === null || saving || !dirty) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch("/api/pos/settings/order-kitchen", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(cashierReviewDraft !== policy.cashier_review_required ? { cashier_review_required: cashierReviewDraft } : {}),
          ...(draft.popup_enabled !== policy.store.popup_enabled && !policy.forced_by_it.popup ? { popup_enabled: draft.popup_enabled } : {}),
          ...(draft.kitchen_auto_send_enabled !== policy.store.kitchen_auto_send_enabled && !policy.forced_by_it.kitchen_auto_send ? { kitchen_auto_send_enabled: draft.kitchen_auto_send_enabled } : {}),
          ...(draft.kitchen_auto_print_enabled !== policy.store.kitchen_auto_print_enabled && !policy.forced_by_it.kitchen_auto_print ? { kitchen_auto_print_enabled: draft.kitchen_auto_print_enabled } : {}),
          ...(kitchenAlertDraft.popup_enabled !== policy.kitchen_alert.popup_enabled ? { kitchen_alert_popup_enabled: kitchenAlertDraft.popup_enabled } : {}),
          ...(kitchenAlertDraft.sound_enabled !== policy.kitchen_alert.sound_enabled ? { kitchen_alert_sound_enabled: kitchenAlertDraft.sound_enabled } : {}),
          ...(kitchenAlertDraft.sound_volume !== policy.kitchen_alert.sound_volume ? { kitchen_alert_sound_volume: kitchenAlertDraft.sound_volume } : {})
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error?.message ?? payload?.message ?? "Save failed"));
      const next = payload?.data?.policy as Policy;
      setPolicy(next);
      setDraft(next.store);
      setKitchenAlertDraft(next.kitchen_alert);
      setCashierReviewDraft(next.cashier_review_required);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const forcedText = (mode: OverrideMode) => th
    ? (mode === "force_on" ? "IT บังคับเปิด" : "IT บังคับปิด")
    : (mode === "force_on" ? "Forced on by IT" : "Forced off by IT");

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/preview/pos/settings" className="text-sm font-bold text-blue-600 hover:text-blue-700">← {th ? "กลับไปเมนูตั้งค่า" : "Back to Settings"}</Link>
          <h1 className="mt-2 text-2xl font-black text-slate-950">{th ? "การแจ้งเตือนออเดอร์และครัว" : "Order & Kitchen Automation"}</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">{th ? "กำหนดการทำงานอัตโนมัติสำหรับออเดอร์ที่ลูกค้าสั่งจาก QR โต๊ะ" : "Control automation for orders submitted from table QR."}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? <div className="p-8 text-center text-sm font-semibold text-slate-500">{th ? "กำลังโหลดการตั้งค่า..." : "Loading settings..."}</div> : null}
        {!loading && policy && draft && kitchenAlertDraft && cashierReviewDraft !== null ? <>
          <SwitchRow
            title={th ? "ให้แคชเชียร์ยืนยันออเดอร์ QR ก่อนส่งครัว" : "Require cashier review before sending table QR orders"}
            description={th ? "เปิด: เก็บออเดอร์ QR รอแคชเชียร์รับและยืนยันก่อนส่งครัว · ปิด: ใช้นโยบายส่งเข้าครัวอัตโนมัติด้านล่าง" : "On: hold QR orders for cashier review. Off: use the automatic Kitchen send rule below."}
            checked={cashierReviewDraft}
            onChange={setCashierReviewDraft}
          />
          <SwitchRow
            title={th ? "แจ้งเตือนออเดอร์ QR บนหน้าขาย" : "QR order popup on sales screen"}
            description={th ? "เมื่อมีออเดอร์ใหม่จาก QR โต๊ะ ให้แสดง POP UP แจ้งเตือนที่หน้าขายโหมดนั่งโต๊ะ" : "Show an incoming-order popup on the dine-in sales screen."}
            checked={shown("popup_enabled", "popup_enabled", policy.forced_by_it.popup)}
            disabled={policy.forced_by_it.popup}
            forcedLabel={policy.forced_by_it.popup ? forcedText(policy.override.popup) : undefined}
            onChange={(value) => setDraft((current) => current ? { ...current, popup_enabled: value } : current)}
          />
          <SwitchRow
            title={th ? "ส่งออเดอร์ QR เข้าครัวอัตโนมัติ" : "Automatically send QR orders to Kitchen"}
            description={th ? "สร้างรายการเข้าหน้าครัวอัตโนมัติเมื่อรับออเดอร์จาก QR โต๊ะ ปิดได้โดยออเดอร์ยังถูกบันทึกตามปกติ" : "Create Kitchen tickets automatically for table QR orders. Orders are still saved when disabled."}
            checked={shown("kitchen_auto_send_enabled", "kitchen_auto_send_enabled", policy.forced_by_it.kitchen_auto_send)}
            disabled={policy.forced_by_it.kitchen_auto_send}
            forcedLabel={policy.forced_by_it.kitchen_auto_send ? forcedText(policy.override.kitchen_auto_send) : undefined}
            onChange={(value) => setDraft((current) => current ? { ...current, kitchen_auto_send_enabled: value } : current)}
          />
          <SwitchRow
            title={th ? "พิมพ์ใบรายการครัวอัตโนมัติ" : "Automatically print Kitchen tickets"}
            description={th ? "สั่งพิมพ์ใบรายการเข้าครัวอัตโนมัติสำหรับออเดอร์ QR การปิดรายการนี้ไม่กระทบการพิมพ์ซ้ำด้วยตนเอง" : "Automatically print Kitchen slips for QR orders. Manual reprints remain available."}
            checked={shown("kitchen_auto_print_enabled", "kitchen_auto_print_enabled", policy.forced_by_it.kitchen_auto_print)}
            disabled={policy.forced_by_it.kitchen_auto_print}
            forcedLabel={policy.forced_by_it.kitchen_auto_print ? forcedText(policy.override.kitchen_auto_print) : undefined}
            onChange={(value) => setDraft((current) => current ? { ...current, kitchen_auto_print_enabled: value } : current)}
          />
          <div className="border-t-4 border-slate-100 bg-blue-50 px-5 py-4">
            <p className="text-base font-black text-slate-950">{th ? "แจ้งเตือนบนหน้าจอครัว (POS และ QR โต๊ะ)" : "Kitchen screen alerts (cashier POS and table QR)"}</p>
            <p className="mt-1 text-sm font-medium text-slate-600">{th ? "แยกจากป๊อปอัปหน้าแคชเชียร์ ใช้เมื่อมีรายการเข้าครัวในโซนที่เปิด KDS" : "Separate from cashier popups; applies when a ticket reaches an enabled KDS zone."}</p>
          </div>
          <SwitchRow
            title={th ? "แสดง POP UP ออเดอร์ใหม่ในครัว" : "Show new Kitchen ticket popup"}
            description={th ? "แสดงเมื่อออเดอร์จากหน้าแคชเชียร์หรือ QR ส่งเข้าครัวสำเร็จ" : "Alert on kitchen tickets from cashier orders or table QR."}
            checked={kitchenAlertDraft.popup_enabled}
            onChange={(value) => setKitchenAlertDraft((current) => current ? { ...current, popup_enabled: value } : current)}
          />
          <SwitchRow
            title={th ? "เปิดเสียงออเดอร์ใหม่ในครัว" : "Play new Kitchen ticket sound"}
            description={th ? "เบราว์เซอร์บางเครื่องต้องแตะปุ่มเปิดเสียงที่หน้าครัวหนึ่งครั้ง" : "Some browsers require tapping Enable Sound once on the kitchen screen."}
            checked={kitchenAlertDraft.sound_enabled}
            onChange={(value) => setKitchenAlertDraft((current) => current ? { ...current, sound_enabled: value } : current)}
          />
          <label className="flex flex-col gap-2 px-5 py-5 text-sm font-bold text-slate-900">
            <span>{th ? "ระดับเสียงแจ้งเตือนในครัว" : "Kitchen alert volume"}: {Math.round(kitchenAlertDraft.sound_volume * 100)}%</span>
            <input type="range" min={0} max={1} step={0.05} value={kitchenAlertDraft.sound_volume}
              disabled={!kitchenAlertDraft.sound_enabled}
              onChange={(event) => setKitchenAlertDraft((current) => current ? { ...current, sound_volume: Number(event.target.value) } : current)}
              aria-label={th ? "ระดับเสียงแจ้งเตือนในครัว" : "Kitchen alert volume"} />
          </label>
        </> : null}
      </div>

      {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
      {saved ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{th ? "บันทึกการตั้งค่าแล้ว" : "Settings saved."}</div> : null}

      <div className="mt-5 flex items-center justify-end gap-3">
        <button type="button" disabled={!dirty || saving || loading} onClick={save} className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
          {saving ? (th ? "กำลังบันทึก..." : "Saving...") : (th ? "บันทึกการตั้งค่า" : "Save settings")}
        </button>
      </div>
      <p className="mt-4 text-xs font-medium leading-5 text-slate-400">{th ? "หาก IT กำหนดนโยบายบังคับ สวิตช์รายการนั้นจะถูกล็อกและแสดงค่าที่ IT กำหนด โดยค่าที่ร้านตั้งไว้เดิมจะถูกเก็บไว้และกลับมาใช้เมื่อ IT ยกเลิกการบังคับ" : "IT-enforced controls are locked. Your store preference is preserved and restored when the override is removed."}</p>
    </main>
  );
}
