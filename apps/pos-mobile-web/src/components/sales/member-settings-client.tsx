"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Barcode, Loader2, Save, Sparkles } from "lucide-react";

type RewardMode = "manual" | "amount_rate" | "fixed_per_bill";

type MemberSettings = {
  pointsMode: RewardMode;
  amountPerPoint: number;
  pointsPerAmount: number;
  fixedPointsPerBill: number;
  stampsMode: RewardMode;
  amountPerStamp: number;
  stampsPerAmount: number;
  fixedStampsPerBill: number;
  qrEnabled: boolean;
  qrTokenTtlMinutes: number;
};

const defaultSettings: MemberSettings = {
  pointsMode: "amount_rate",
  amountPerPoint: 100,
  pointsPerAmount: 1,
  fixedPointsPerBill: 0,
  stampsMode: "manual",
  amountPerStamp: 100,
  stampsPerAmount: 1,
  fixedStampsPerBill: 0,
  qrEnabled: true,
  qrTokenTtlMinutes: 15,
};

const modeOptions: { value: RewardMode; label: string }[] = [
  { value: "amount_rate", label: "ตามยอดขาย" },
  { value: "fixed_per_bill", label: "คงที่ต่อบิล" },
  { value: "manual", label: "กรอกเองหน้าแคชเชียร์" },
];

function numberValue(value: FormDataEntryValue | null, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function MemberSettingsClient() {
  const [settings, setSettings] = useState<MemberSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [qrCode, setQrCode] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/mobile/members/settings", { cache: "no-store" })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error?.message ?? "โหลดตั้งค่าสมาชิกไม่สำเร็จ");
        return payload?.data?.settings as MemberSettings;
      })
      .then((data) => {
        if (!active) return;
        setSettings(data ?? defaultSettings);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "โหลดตั้งค่าสมาชิกไม่สำเร็จ");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const pointsPreview = useMemo(() => {
    if (settings.pointsMode === "manual") return "แคชเชียร์กรอกคะแนนเองตอนผูกบิล";
    if (settings.pointsMode === "fixed_per_bill") return `ได้ ${settings.fixedPointsPerBill} คะแนนต่อบิล`;
    return `ทุก ${settings.amountPerPoint} บาท ได้ ${settings.pointsPerAmount} คะแนน`;
  }, [settings]);

  const stampsPreview = useMemo(() => {
    if (settings.stampsMode === "manual") return "แคชเชียร์กรอกแต้มเองตอนผูกบิล";
    if (settings.stampsMode === "fixed_per_bill") return `ได้ ${settings.fixedStampsPerBill} แต้มต่อบิล`;
    return `ทุก ${settings.amountPerStamp} บาท ได้ ${settings.stampsPerAmount} แต้ม`;
  }, [settings]);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    const form = new FormData(event.currentTarget);
    const nextSettings: MemberSettings = {
      pointsMode: String(form.get("pointsMode") ?? defaultSettings.pointsMode) as RewardMode,
      amountPerPoint: numberValue(form.get("amountPerPoint"), defaultSettings.amountPerPoint),
      pointsPerAmount: numberValue(form.get("pointsPerAmount"), defaultSettings.pointsPerAmount),
      fixedPointsPerBill: numberValue(form.get("fixedPointsPerBill"), defaultSettings.fixedPointsPerBill),
      stampsMode: String(form.get("stampsMode") ?? defaultSettings.stampsMode) as RewardMode,
      amountPerStamp: numberValue(form.get("amountPerStamp"), defaultSettings.amountPerStamp),
      stampsPerAmount: numberValue(form.get("stampsPerAmount"), defaultSettings.stampsPerAmount),
      fixedStampsPerBill: numberValue(form.get("fixedStampsPerBill"), defaultSettings.fixedStampsPerBill),
      qrEnabled: form.get("qrEnabled") === "on",
      qrTokenTtlMinutes: numberValue(form.get("qrTokenTtlMinutes"), defaultSettings.qrTokenTtlMinutes),
    };

    try {
      const res = await fetch("/api/mobile/members/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSettings),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error?.message ?? "บันทึกตั้งค่าสมาชิกไม่สำเร็จ");
      setSettings(payload?.data?.settings ?? nextSettings);
      setMessage("บันทึกตั้งค่าสมาชิกแล้ว");
    } catch (err) {
      setError(err instanceof Error ? err.message : "บันทึกตั้งค่าสมาชิกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="card flex min-h-[260px] items-center justify-center rounded-[18px] p-6 text-[#587398]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        กำลังโหลดตั้งค่าสมาชิก
      </div>
    );
  }

  return (
    <form onSubmit={saveSettings} className="grid gap-4 pb-28">
      {error && <div className="rounded-[16px] border border-red-200 bg-red-50 p-3 text-[13px] font-bold text-red-700">{error}</div>}
      {message && <div className="rounded-[16px] border border-emerald-200 bg-emerald-50 p-3 text-[13px] font-bold text-emerald-700">{message}</div>}

      <section className="card rounded-[18px] p-4">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[#eef6ff] text-[#1677d9]">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h2 className="m-0 text-[18px] font-black text-[#0f2745]">คะแนนสมาชิก</h2>
            <p className="m-0 text-[12px] font-bold text-[#587398]">{pointsPreview}</p>
          </div>
        </div>
        <select name="pointsMode" value={settings.pointsMode} onChange={(event) => setSettings((prev) => ({ ...prev, pointsMode: event.target.value as RewardMode }))} className="mb-3 h-12 w-full rounded-[14px] border border-[#cfe3ff] bg-white px-3 text-[14px] font-black text-[#0f2745]">
          {modeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <label className="text-[12px] font-black text-[#587398]">
            บาทต่อรอบ
            <input name="amountPerPoint" type="number" min="1" value={settings.amountPerPoint} onChange={(event) => setSettings((prev) => ({ ...prev, amountPerPoint: Number(event.target.value) }))} className="mt-1 h-11 w-full min-w-0 rounded-[14px] border border-[#cfe3ff] px-3 text-[15px] text-[#0f2745]" />
          </label>
          <label className="text-[12px] font-black text-[#587398]">
            คะแนนต่อรอบ
            <input name="pointsPerAmount" type="number" min="0" value={settings.pointsPerAmount} onChange={(event) => setSettings((prev) => ({ ...prev, pointsPerAmount: Number(event.target.value) }))} className="mt-1 h-11 w-full min-w-0 rounded-[14px] border border-[#cfe3ff] px-3 text-[15px] text-[#0f2745]" />
          </label>
          <label className="col-span-2 text-[12px] font-black text-[#587398]">
            คะแนนคงที่ต่อบิล
            <input name="fixedPointsPerBill" type="number" min="0" value={settings.fixedPointsPerBill} onChange={(event) => setSettings((prev) => ({ ...prev, fixedPointsPerBill: Number(event.target.value) }))} className="mt-1 h-11 w-full min-w-0 rounded-[14px] border border-[#cfe3ff] px-3 text-[15px] text-[#0f2745]" />
          </label>
        </div>
      </section>

      <section className="card rounded-[18px] p-4">
        <h2 className="m-0 text-[18px] font-black text-[#0f2745]">แต้มสะสม</h2>
        <p className="m-0 mb-3 text-[12px] font-bold text-[#587398]">{stampsPreview}</p>
        <select name="stampsMode" value={settings.stampsMode} onChange={(event) => setSettings((prev) => ({ ...prev, stampsMode: event.target.value as RewardMode }))} className="mb-3 h-12 w-full rounded-[14px] border border-[#cfe3ff] bg-white px-3 text-[14px] font-black text-[#0f2745]">
          {modeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <label className="text-[12px] font-black text-[#587398]">
            บาทต่อรอบ
            <input name="amountPerStamp" type="number" min="1" value={settings.amountPerStamp} onChange={(event) => setSettings((prev) => ({ ...prev, amountPerStamp: Number(event.target.value) }))} className="mt-1 h-11 w-full min-w-0 rounded-[14px] border border-[#cfe3ff] px-3 text-[15px] text-[#0f2745]" />
          </label>
          <label className="text-[12px] font-black text-[#587398]">
            แต้มต่อรอบ
            <input name="stampsPerAmount" type="number" min="0" value={settings.stampsPerAmount} onChange={(event) => setSettings((prev) => ({ ...prev, stampsPerAmount: Number(event.target.value) }))} className="mt-1 h-11 w-full min-w-0 rounded-[14px] border border-[#cfe3ff] px-3 text-[15px] text-[#0f2745]" />
          </label>
          <label className="col-span-2 text-[12px] font-black text-[#587398]">
            แต้มคงที่ต่อบิล
            <input name="fixedStampsPerBill" type="number" min="0" value={settings.fixedStampsPerBill} onChange={(event) => setSettings((prev) => ({ ...prev, fixedStampsPerBill: Number(event.target.value) }))} className="mt-1 h-11 w-full min-w-0 rounded-[14px] border border-[#cfe3ff] px-3 text-[15px] text-[#0f2745]" />
          </label>
        </div>
      </section>

      <section className="card rounded-[18px] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[#eef6ff] text-[#1677d9]">
              <Barcode className="h-5 w-5" />
            </span>
            <div>
              <h2 className="m-0 text-[18px] font-black text-[#0f2745]">QR รับคะแนน</h2>
              <p className="m-0 text-[12px] font-bold text-[#587398]">สแกนรหัสเพื่อรับคะแนนหรือแต้มเข้าบัญชีสมาชิก</p>
            </div>
          </div>
          <input name="qrEnabled" type="checkbox" checked={settings.qrEnabled} onChange={(event) => setSettings((prev) => ({ ...prev, qrEnabled: event.target.checked }))} className="h-6 w-6 accent-[#1677d9]" />
        </div>
        <label className="mt-4 block text-[12px] font-black text-[#587398]">
          อายุ QR token (นาที)
          <input name="qrTokenTtlMinutes" type="number" min="1" max="1440" value={settings.qrTokenTtlMinutes} onChange={(event) => setSettings((prev) => ({ ...prev, qrTokenTtlMinutes: Number(event.target.value) }))} className="mt-1 h-11 w-full min-w-0 rounded-[14px] border border-[#cfe3ff] px-3 text-[15px] text-[#0f2745]" />
        </label>
        <div className="mt-3 flex gap-2">
          <input value={qrCode} onChange={(event) => setQrCode(event.target.value)} placeholder="สแกนหรือกรอกรหัส QR" className="h-11 min-w-0 flex-1 rounded-[14px] border border-[#cfe3ff] px-3 text-[14px] font-bold text-[#0f2745]" />
          <button type="button" disabled={!settings.qrEnabled || !qrCode.trim()} className="h-11 rounded-[14px] border border-[#cfe3ff] px-4 text-[13px] font-black text-[#1677d9] disabled:opacity-45">ตรวจ</button>
        </div>
      </section>

      <button type="submit" disabled={saving} className="flex h-[52px] items-center justify-center rounded-[16px] bg-[#1677d9] px-4 py-3 text-[15px] font-black text-white shadow-[0_12px_28px_rgba(22,119,217,0.22)] disabled:opacity-60">
        {saving ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />}
        บันทึกตั้งค่า
      </button>
    </form>
  );
}
