"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

type ContextResponse = {
  data?: { stage?: string; tenant?: { name?: string } | null } | null;
};

const inputStyle =
  "h-12 w-full rounded-lg border border-[#cedae9] bg-white pr-4 text-[15px] font-medium text-slate-900 outline-none transition-colors placeholder:font-normal placeholder:text-slate-400 hover:border-[#a8c1df] focus:border-[#1763be] focus:ring-[3px] focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50";

function LoginIcon({ name }: { name: "employee" | "lock" | "store" | "eye" | "eye-off" | "arrow" }) {
  const shared = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "employee") return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[19px] w-[19px]" {...shared}>
    <circle cx="12" cy="8" r="3.5" /><path d="M5 20v-2a7 7 0 0 1 14 0v2M4.5 20h15" />
  </svg>;
  if (name === "lock") return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[19px] w-[19px]" {...shared}>
    <rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
  </svg>;
  if (name === "store") return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" {...shared}>
    <path d="M3 10h18l-2-6H5l-2 6ZM5 10v10h14V10M9 20v-6h6v6M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
  </svg>;
  if (name === "eye" || name === "eye-off") return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[19px] w-[19px]" {...shared}>
    <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.5" />
    {name === "eye-off" ? <path d="m4 4 16 16" /> : null}
  </svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[17px] w-[17px]" {...shared}>
    <path d="m12 18-6-6 6-6M6 12h14" />
  </svg>;
}

export default function AccountingLoginPage() {
  const router = useRouter();
  const [store, setStore] = useState("");
  const [contextReady, setContextReady] = useState(false);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session/context", { cache: "no-store" })
      .then(async (res) => res.ok ? await res.json() as ContextResponse : null)
      .then((body) => {
        if (!active) return;
        if (!body?.data?.tenant || !["store_verified", "branch_selected"].includes(body.data.stage ?? "")) {
          router.replace("/login/store");
          return;
        }
        setStore(body.data.tenant.name ?? "");
        setContextReady(true);
      })
      .catch(() => { if (active) setError("ไม่สามารถตรวจสอบร้านค้าได้ กรุณาลองใหม่"); });
    return () => { active = false; };
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const result = await fetch("/api/auth/accounting/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_code: code, pin }),
        cache: "no-store"
      });
      const body = await result.json().catch(() => null) as
        { data?: { redirect_to?: string }; error?: { message?: string } } | null;
      if (!result.ok || body?.data?.redirect_to !== "/finance") {
        setError(body?.error?.message ?? "เข้าสู่ระบบไม่สำเร็จ");
        setPin("");
        return;
      }
      window.location.replace("/finance");
    } catch {
      setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative isolate flex min-h-screen min-h-[100dvh] items-center justify-center overflow-hidden bg-[#edf3f9] px-4 py-6 text-slate-900 sm:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[42%] bg-gradient-to-b from-[#e5eef9] to-transparent" />
      <section aria-labelledby="accounting-login-title"
        className="relative w-full max-w-[468px] overflow-hidden rounded-[20px] border border-[#d5e0ed] bg-white shadow-[0_18px_46px_-24px_rgba(18,49,89,0.42)]">
        <div aria-hidden="true" className="h-1 bg-gradient-to-r from-[#123a69] via-[#1657b3] to-[#2d9bce]" />
        <div className="px-5 pb-5 pt-6 sm:px-8 sm:pb-7 sm:pt-8">
          <header>
            <div className="flex items-center gap-3">
              <span className="flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-xl bg-[#0b3054] shadow-[0_3px_10px_rgba(11,48,84,0.15)]">
                <Image src="/brand/cpipos-symbol-transparent.png" alt="" aria-hidden="true"
                  width={48} height={48} priority className="h-[45px] w-[45px] object-contain" />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-black tracking-[0.015em] text-[#123d72]">
                  Cpi<span className="text-[#178ecb]">POS</span>
                  <span className="ml-2 border-l border-slate-300 pl-2 text-[12px] font-bold tracking-[0.08em] text-slate-500">FINANCE</span>
                </p>
                <p className="mt-0.5 text-[11px] font-medium text-slate-500">ระบบจัดการการเงินและบัญชี</p>
              </div>
            </div>

            <h1 id="accounting-login-title" className="mt-7 text-[22px] font-extrabold leading-tight tracking-tight text-[#132e50] sm:text-[24px]">
              เข้าสู่ระบบฝ่ายบัญชี
            </h1>
            <p className="mt-2 text-[13px] leading-6 text-slate-500">
              กรอกรหัสพนักงานและ PIN เพื่อเข้าถึงงานบัญชีของร้านค้า
            </p>
          </header>

          <div className="mt-5 flex items-start gap-3 rounded-lg border border-[#dce7f6] bg-[#f5f9fe] px-3.5 py-3">
            <span className="mt-0.5 shrink-0 text-[#2769ab]"><LoginIcon name="store" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-slate-500">ร้านค้าที่เลือก</p>
              <p role="status" className="mt-0.5 break-words text-[13px] font-bold leading-5 text-[#163c66]">
                {store || "กำลังตรวจสอบร้านค้า..."}
              </p>
            </div>
            {contextReady ? (
              <span className="mt-0.5 shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                ยืนยันแล้ว
              </span>
            ) : null}
          </div>
          <p className="mt-2.5 text-xs leading-5 text-slate-500">
            ใช้สิทธิ์ฝ่ายบัญชีตามสาขาที่ได้รับอนุญาต ไม่ต้องเลือกเครื่อง POS
          </p>

          <form onSubmit={submit} className="mt-6 space-y-[18px]">
            <div>
              <label htmlFor="accounting-employee-code" className="mb-2 block text-[13px] font-bold text-slate-700">
                รหัสพนักงานบัญชี
              </label>
              <div className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center text-slate-400">
                  <LoginIcon name="employee" />
                </span>
                <input id="accounting-employee-code" name="employee_code"
                  type="text" inputMode="numeric" autoComplete="username" enterKeyHint="next"
                  pattern="[0-9]{1,32}" maxLength={32} placeholder="กรอกรหัสพนักงาน"
                  className={inputStyle + " pl-11"}
                  value={code}
                  onChange={(event) => { setCode(event.target.value.replace(/\D/g, "").slice(0, 32)); setError(""); }}
                  required />
              </div>
            </div>

            <div>
              <label htmlFor="accounting-pin" className="mb-2 block text-[13px] font-bold text-slate-700">
                PIN ยืนยันตัวตน
              </label>
              <div className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex w-11 items-center justify-center text-slate-400">
                  <LoginIcon name="lock" />
                </span>
                <input id="accounting-pin" name="pin"
                  type={showPin ? "text" : "password"}
                  inputMode="numeric" autoComplete="current-password" enterKeyHint="go"
                  pattern="[0-9]{4,8}" minLength={4} maxLength={8}
                  placeholder="PIN 4–8 หลัก"
                  className={inputStyle + " pl-11 pr-12"}
                  value={pin}
                  onChange={(event) => { setPin(event.target.value.replace(/\D/g, "").slice(0, 8)); setError(""); }}
                  required />
                <button type="button" aria-label={showPin ? "ซ่อน PIN" : "แสดง PIN"}
                  aria-pressed={showPin} title={showPin ? "ซ่อน PIN" : "แสดง PIN"}
                  onClick={() => setShowPin(value => !value)}
                  className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-blue-600">
                  <LoginIcon name={showPin ? "eye" : "eye-off"} />
                </button>
              </div>
            </div>

            {error ? (
              <div id="accounting-login-error" role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] leading-5 text-red-700">
                <span aria-hidden="true" className="mt-0.5 font-black">!</span>
                <span>{error}</span>
              </div>
            ) : null}

            <button type="submit" disabled={busy || !contextReady}
              aria-busy={busy}
              className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#174bd8] px-4 text-[14px] font-extrabold text-white shadow-[0_5px_12px_rgba(23,75,216,0.15)] transition-colors hover:bg-[#123cb6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? (
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] animate-spin" fill="none">
                  <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
                  <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : null}
              {busy ? "กำลังยืนยัน..." : "เข้าสู่เมนูการเงิน"}
              {!busy ? <span className="text-lg leading-none" aria-hidden="true">›</span> : null}
            </button>
          </form>

          <div className="mt-5 border-t border-slate-100 pt-4 text-center">
            <button type="button" onClick={() => router.push("/login/store")}
              className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-[13px] font-semibold text-[#306493] transition-colors hover:bg-blue-50 hover:text-[#174bd8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
              <LoginIcon name="arrow" />
              กลับไปหน้ารหัสร้าน
            </button>
          </div>
        </div>
        <footer className="flex items-center justify-center gap-2 border-t border-slate-100 bg-[#fbfcfe] px-5 py-3 text-center text-[11px] text-slate-500">
          <span aria-hidden="true" className="text-[#49749e]"><LoginIcon name="lock" /></span>
          สำหรับผู้ได้รับสิทธิ์ฝ่ายบัญชีเท่านั้น
        </footer>
      </section>
    </main>
  );
}
