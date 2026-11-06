"use client";

import { useState } from "react";
import { useAppLanguage, type AppLanguage } from "@/lib/app-language-client";

type Props = {
  initialLanguage: AppLanguage;
  role: "staff" | "kitchen";
  languageEnabled?: boolean;
};

const COPY = {
  th: {
    title: "ตั้งค่าส่วนตัว",
    desc: "การตั้งค่านี้ใช้เฉพาะรหัสผู้ใช้งานที่กำลังเข้าสู่ระบบ",
    language: "เปลี่ยนภาษา",
    languageDesc: "เลือกภาษาสำหรับรหัสผู้ใช้งานนี้",
    current: "ภาษาปัจจุบัน",
    saving: "กำลังบันทึก...",
    failed: "ไม่สามารถบันทึกภาษาได้",
    thai: "ภาษาไทย",
    english: "English",
    lao: "ລາວ",
    locked: "เมนูเปลี่ยนภาษาถูกปิดโดยผู้ดูแลระบบ IT"
  },
  en: {
    title: "Personal Settings",
    desc: "These settings apply only to the currently signed-in user.",
    language: "Change Language",
    languageDesc: "Choose the language for this user account.",
    current: "Current language",
    saving: "Saving...",
    failed: "Unable to save language preference.",
    thai: "ภาษาไทย",
    english: "English",
    lao: "ລາວ",
    locked: "Change Language is disabled by the IT administrator."
  },
  lo: {
    title: "ຕັ້ງຄ່າສ່ວນຕົວ",
    desc: "ການຕັ້ງຄ່ານີ້ໃຊ້ສຳລັບລະຫັດຜູ້ໃຊ້ທີ່ກຳລັງເຂົ້າລະບົບເທົ່ານັ້ນ",
    language: "ປ່ຽນພາສາ",
    languageDesc: "ເລືອກພາສາສຳລັບຜູ້ໃຊ້ນີ້",
    current: "ພາສາປັດຈຸບັນ",
    saving: "ກຳລັງບັນທຶກ...",
    failed: "ບໍ່ສາມາດບັນທຶກພາສາໄດ້",
    thai: "ภาษาไทย",
    english: "English",
    lao: "ລາວ",
    locked: "ເມນູປ່ຽນພາສາຖືກປິດໂດຍຜູ້ດູແລ IT"
  }
} as const;

const OPTIONS: Array<{ code: AppLanguage; short: string }> = [
  { code: "th", short: "TH" },
  { code: "en", short: "EN" },
  { code: "lo", short: "LO" }
];

export function PosPersonalSettings({ initialLanguage, role, languageEnabled = true }: Props) {
  const { lang, setLanguage } = useAppLanguage(initialLanguage);
  const [saving, setSaving] = useState<AppLanguage | null>(null);
  const [error, setError] = useState("");
  const copy = COPY[lang];

  async function chooseLanguage(nextLanguage: AppLanguage) {
    if (!languageEnabled || saving || nextLanguage === lang) return;
    setSaving(nextLanguage);
    setError("");
    try {
      const response = await fetch("/api/pos/settings/language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: nextLanguage }),
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string } | null } | null;
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? copy.failed);
      }
      setLanguage(nextLanguage);
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.failed);
      setSaving(null);
    }
  }

  function languageName(code: AppLanguage) {
    if (code === "th") return copy.thai;
    if (code === "en") return copy.english;
    return copy.lao;
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h1 className="text-xl font-black text-slate-950">{copy.title}</h1>
        <p className="mt-1 text-sm font-semibold text-slate-500">{copy.desc}</p>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-100 font-black text-blue-700">A</div>
          <div className="min-w-0 flex-1">
            <h2 className="font-black text-slate-950">{copy.language}</h2>
            <p className="mt-1 text-sm font-medium text-slate-500">{copy.languageDesc}</p>
            <p className="mt-2 text-sm font-bold text-blue-700">{copy.current}: {languageName(lang)}</p>
          </div>
        </div>

        {languageEnabled ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {OPTIONS.map((option) => {
              const active = option.code === lang;
              const busy = saving === option.code;
              return (
                <button
                  key={option.code}
                  type="button"
                  disabled={Boolean(saving)}
                  onClick={() => void chooseLanguage(option.code)}
                  className={`min-h-16 rounded-xl border px-4 py-3 text-left transition disabled:cursor-wait disabled:opacity-60 ${
                    active
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-800 hover:border-blue-200 hover:bg-blue-50/50"
                  }`}
                >
                  <span className="block text-xs font-black">{option.short}</span>
                  <span className="mt-1 block font-black">{busy ? copy.saving : languageName(option.code)}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800">{copy.locked}</p>
        )}

        {error ? <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
      </div>

      <span className="sr-only">{role}</span>
    </section>
  );
}
