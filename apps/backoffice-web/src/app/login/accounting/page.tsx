"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type ContextResponse = {
  data?: { stage?: string; tenant?: { name?: string } | null } | null;
};

export default function AccountingLoginPage() {
  const router = useRouter();
  const [store, setStore] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
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
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4 text-slate-900">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-xl">
        <span className="text-xs font-bold uppercase tracking-widest text-blue-700">CpiPOS FINANCE</span>
        <h1 className="mt-2 text-2xl font-bold">เข้าสู่ระบบฝ่ายบัญชี</h1>
        <p className="mt-2 text-sm text-slate-600">{store || "กำลังตรวจสอบร้านค้า..."}</p>
        <p className="mt-1 text-sm text-slate-600">ใช้สิทธิ์บัญชีของร้านนี้ได้ทุกสาขา โดยไม่ต้องเลือกสาขาหรือเครื่อง POS</p>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="block text-sm font-semibold">รหัสพนักงานบัญชี
            <input inputMode="numeric" autoComplete="username" pattern="[0-9]{1,32}"
              className="mt-1 w-full rounded-xl border border-slate-300 p-3"
              value={code} onChange={(event) => setCode(event.target.value.replace(/\\D/g, "").slice(0, 32))}
              required />
          </label>
          <label className="block text-sm font-semibold">PIN ยืนยันตัวตน
            <input type="password" inputMode="numeric" autoComplete="current-password"
              pattern="[0-9]{4,6}" minLength={4} maxLength={6}
              className="mt-1 w-full rounded-xl border border-slate-300 p-3"
              value={pin} onChange={(event) => setPin(event.target.value.replace(/\\D/g, "").slice(0, 6))}
              required />
          </label>
          {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}
          <button type="submit" disabled={busy || !store}
            className="w-full rounded-xl bg-blue-700 p-3 font-bold text-white disabled:opacity-60">
            {busy ? "กำลังยืนยัน..." : "เข้าสู่เมนูการเงิน"}
          </button>
        </form>
        <button type="button" onClick={() => router.push("/login/store")}
          className="mt-4 w-full text-sm text-slate-600 underline">กลับไปหน้ารหัสร้าน</button>
      </section>
    </main>
  );
}
