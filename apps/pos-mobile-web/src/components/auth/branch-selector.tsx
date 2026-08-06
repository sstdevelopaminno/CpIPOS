"use client";

import { LoadingDialog } from "@/components/auth/loading-dialog";
import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Branch = { id: string; name: string | null; code: string | null };

function networkErrorMessage(error: unknown, fallback: string) {
  if (error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message)) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจว่า npm run dev ยังเปิดอยู่ แล้วลองใหม่";
  }
  return error instanceof Error ? error.message : fallback;
}

export function BranchSelector({ branches }: { branches: Branch[] }) {
  const router = useRouter();
  const navigationWatchdogRef = useRef<number | null>(null);
  const [selectedId, setSelectedId] = useState(branches[0]?.id ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const canSubmit = Boolean(selectedId) && !loading;

  useEffect(() => {
    return () => {
      if (navigationWatchdogRef.current) window.clearTimeout(navigationWatchdogRef.current);
    };
  }, []);

  async function submit() {
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    let keepLoadingForNavigation = false;
    try {
      const res = await fetch("/api/auth/branches/select", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({ branchId: selectedId }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? "เลือกสาขาไม่สำเร็จ");
      keepLoadingForNavigation = true;
      window.location.assign(json.data.redirectTo);
      navigationWatchdogRef.current = window.setTimeout(() => {
        setLoading(false);
        setError("การเปลี่ยนหน้าช้ากว่าปกติ กรุณากดถัดไปอีกครั้ง");
      }, 10_000);
    } catch (err) {
      setError(networkErrorMessage(err, "เลือกสาขาไม่สำเร็จ"));
    } finally {
      if (!keepLoadingForNavigation) setLoading(false);
    }
  }

  return (
    <>
      <div className="space-y-3">
        <section className="rounded-xl border border-[#c9dbf2] bg-white p-3">
          <h2 className="mb-3 text-base font-bold text-[#0f2745]">เลือกสาขา</h2>
          <div className="space-y-3">
            {branches.map((branch) => {
              const active = branch.id === selectedId;
              return (
                <button
                  key={branch.id}
                  type="button"
                  className={`flex min-h-[88px] w-full touch-manipulation items-center gap-3 rounded-xl border px-3 py-3 text-left transition active:scale-[0.99] disabled:opacity-60 ${
                    active ? "border-[#1677ff] bg-[#eef6ff]" : "border-[#c9dbf2] bg-white"
                  }`}
                  disabled={loading}
                  onClick={() => setSelectedId(branch.id)}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#bcd5f5] bg-white text-[#1f6fd1]">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <span className="block min-w-0">
                    <span className="block truncate text-sm font-bold text-[#0f2745]">{branch.name ?? "สาขา"}</span>
                    {branch.code ? <span className="mt-1 block text-xs font-medium text-[#587398]">รหัสสาขา: {branch.code}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
          {branches.length === 0 ? <p className="text-sm text-slate-500">ไม่พบสาขาที่พร้อมใช้งาน</p> : null}
        </section>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" className="touch-manipulation rounded-xl border border-[#bcd5f5] bg-white px-4 py-3 text-sm font-semibold text-[#17416f]" onClick={() => router.push("/login/store")} disabled={loading}>
            กลับ
          </button>
          <button
            type="button"
            className={`touch-manipulation rounded-xl px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed ${canSubmit ? "bg-[#1677d9] hover:bg-[#075fbb]" : "bg-[#aacdf3] opacity-80"}`}
            onClick={submit}
            disabled={!canSubmit}
          >
            {loading ? "กำลังเลือก..." : "ถัดไป"}
          </button>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
      <LoadingDialog open={loading} title="กำลังตรวจสอบ" message="กำลังยืนยันสาขาที่เลือก..." />
    </>
  );
}
