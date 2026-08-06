"use client";

import { LoadingDialog } from "@/components/auth/loading-dialog";
import { Eye, EyeOff, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const AUTO_HIDE_MS = 5_000;

function onlyDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 32);
}

function networkErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message)) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจว่า npm run dev ยังเปิดอยู่ แล้วลองใหม่";
  }
  return error instanceof Error ? error.message : fallback;
}

export function EmployeeLoginForm({ branchName }: { branchName: string }) {
  const router = useRouter();
  const navigationWatchdogRef = useRef<number | null>(null);
  const autoHideRef = useRef<number | null>(null);
  const [employeeCode, setEmployeeCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const canSubmit = employeeCode.trim().length > 0 && !loading;

  useEffect(() => {
    return () => {
      if (navigationWatchdogRef.current) window.clearTimeout(navigationWatchdogRef.current);
      if (autoHideRef.current) window.clearTimeout(autoHideRef.current);
    };
  }, []);

  function revealTemporarily() {
    setShowCode((current) => {
      const next = !current;
      if (autoHideRef.current) window.clearTimeout(autoHideRef.current);
      if (next) {
        autoHideRef.current = window.setTimeout(() => setShowCode(false), AUTO_HIDE_MS);
      }
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setShowCode(false);
    setLoading(true);
    setError("");
    let keepLoadingForNavigation = false;
    try {
      const res = await fetch("/api/auth/employee/verify", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({ employeeCode }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? "เข้าสู่ระบบไม่สำเร็จ");
      keepLoadingForNavigation = true;
      window.location.assign(json.data.redirectTo);
      navigationWatchdogRef.current = window.setTimeout(() => {
        setLoading(false);
        setError("การเปลี่ยนหน้าช้ากว่าปกติ กรุณากดยืนยันอีกครั้ง");
      }, 10_000);
    } catch (err) {
      setError(networkErrorMessage(err, "เข้าสู่ระบบไม่สำเร็จ"));
    } finally {
      if (!keepLoadingForNavigation) setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#17416f]">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#bcd5f5] bg-[#eef6ff]">
            <Store className="h-5 w-5" />
          </span>
          <span>สาขา: {branchName}</span>
        </div>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-[#0f2745]">รหัสพนักงาน</span>
          <span className="flex h-[52px] items-center rounded-xl border border-[#c9dbf2] bg-white px-3 transition focus-within:border-[#1677ff] focus-within:ring-2 focus-within:ring-[#d8eaff]">
            <input
              className="h-full min-w-0 flex-1 touch-manipulation bg-transparent text-base font-medium text-[#0f2745] outline-none placeholder:text-[#8aa0ba]"
              placeholder="กรอกรหัสตัวเลข"
              value={employeeCode}
              onChange={(e) => setEmployeeCode(onlyDigits(e.target.value))}
              onBlur={() => setShowCode(false)}
              disabled={loading}
              autoComplete="one-time-code"
              enterKeyHint="next"
              inputMode="numeric"
              pattern="[0-9]*"
              type={showCode ? "text" : "password"}
            />
            <button
              type="button"
              className="relative z-10 ml-2 flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-lg text-[#38669b] outline-none transition active:bg-[#eef6ff] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2"
              onMouseDown={(event) => event.preventDefault()}
              onClick={revealTemporarily}
              disabled={loading || employeeCode.length === 0}
              aria-label={showCode ? "ซ่อนรหัสพนักงาน" : "แสดงรหัสพนักงาน"}
              aria-pressed={showCode}
            >
              {showCode ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </span>
          <span className="block text-xs text-[#587398]">รับเฉพาะตัวเลข และจะซ่อนรหัสอัตโนมัติหลังเปิดดู</span>
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          className={`w-full touch-manipulation rounded-xl px-4 py-3 text-sm font-bold text-white transition active:scale-[0.99] disabled:cursor-not-allowed ${canSubmit ? "bg-[#1677d9] hover:bg-[#075fbb]" : "bg-[#728091] opacity-90"}`}
        >
          {loading ? "กำลังยืนยัน..." : "ยืนยันพนักงาน"}
        </button>
        <button type="button" className="w-full touch-manipulation rounded-xl border border-[#bcd5f5] bg-white px-4 py-3 text-sm font-semibold text-[#17416f]" onClick={() => router.push("/login/branch")} disabled={loading}>
          ย้อนกลับ
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
      <LoadingDialog open={loading} title="กำลังตรวจสอบ" message="กำลังยืนยันตัวตนพนักงาน..." />
    </>
  );
}
