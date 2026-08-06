"use client";

import { Building2, LogOut, Monitor, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type LogoutResponse = {
  data?: {
    redirectTo?: string;
  } | null;
};

type LogoutAction = "switch_branch" | "switch_device" | "logout";

const fallbackRedirect: Record<LogoutAction, string> = {
  switch_branch: "/login/branch",
  switch_device: "/login/device",
  logout: "/login/store",
};

export function LogoutButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loadingAction, setLoadingAction] = useState<LogoutAction | null>(null);

  async function submit(action: LogoutAction) {
    if (loadingAction) return;
    setLoadingAction(action);
    try {
      const response = await fetch("/api/auth/session/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({ action }),
      });
      const json = await response.json().catch(() => null) as LogoutResponse | null;
      router.replace(json?.data?.redirectTo ?? fallbackRedirect[action]);
      router.refresh();
    } finally {
      setLoadingAction(null);
      setOpen(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="ออกจากระบบ"
        title="ออกจากระบบ"
        className="flex h-12 w-12 items-center justify-center rounded-full border border-[#e4effb] bg-white text-[#17416f] shadow-[0_8px_22px_rgba(15,39,69,0.1)] transition active:scale-95"
      >
        <LogOut size={22} strokeWidth={2.25} />
      </button>

      {open ? (
        <div role="dialog" aria-modal="true" aria-label="ตัวเลือกออกจากระบบ" className="fixed inset-0 z-[230] flex items-end justify-center bg-[rgba(15,39,69,0.34)] px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
          <section className="w-full max-w-[390px] rounded-[24px] border border-[#cfe3fa] bg-white p-4 shadow-[0_22px_60px_rgba(15,39,69,0.24)]">
            <header className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-[20px] font-black leading-tight text-[#0f2745]">ออกจากหน้าขาย</h2>
                <p className="m-0 mt-1 text-[13px] font-bold leading-snug text-[#587398]">เลือกว่าจะเปลี่ยนเครื่อง เปลี่ยนสาขา หรือออกจากระบบทั้งหมด</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="ปิด" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#d9e8f7] bg-white text-[#17416f]">
                <X size={18} />
              </button>
            </header>

            <div className="grid gap-3">
              <button
                type="button"
                onClick={() => void submit("switch_device")}
                disabled={Boolean(loadingAction)}
                className="flex min-h-[58px] items-center gap-3 rounded-[18px] border border-[#cfe3fa] bg-[#f8fbff] px-4 text-left text-[#0f2745] transition active:scale-[0.99] disabled:opacity-60"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#eef6ff] text-[#1677d9]">
                  <Monitor size={22} strokeWidth={2.35} />
                </span>
                <span className="min-w-0">
                  <b className="block text-[15px] font-black">เลือกเครื่องแคชเชียร์</b>
                  <span className="mt-0.5 block text-[12px] font-bold leading-snug text-[#587398]">อยู่สาขาเดิม แล้วเลือกเครื่องแคชเชียร์ใหม่</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => void submit("switch_branch")}
                disabled={Boolean(loadingAction)}
                className="flex min-h-[58px] items-center gap-3 rounded-[18px] border border-[#cfe3fa] bg-[#f8fbff] px-4 text-left text-[#0f2745] transition active:scale-[0.99] disabled:opacity-60"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#eef6ff] text-[#1677d9]">
                  <Building2 size={22} strokeWidth={2.35} />
                </span>
                <span className="min-w-0">
                  <b className="block text-[15px] font-black">เลือกสาขาใหม่</b>
                  <span className="mt-0.5 block text-[12px] font-bold leading-snug text-[#587398]">กลับไปเลือกสาขา โดยออกจาก session เครื่องนี้ก่อน</span>
                </span>
              </button>

              <button
                type="button"
                onClick={() => void submit("logout")}
                disabled={Boolean(loadingAction)}
                className="flex min-h-[58px] items-center gap-3 rounded-[18px] border border-[#ffd3d3] bg-[#fff8f8] px-4 text-left text-[#8a1f1f] transition active:scale-[0.99] disabled:opacity-60"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-white text-[#d03434]">
                  <LogOut size={22} strokeWidth={2.35} />
                </span>
                <span className="min-w-0">
                  <b className="block text-[15px] font-black">ออกทั้งระบบ</b>
                  <span className="mt-0.5 block text-[12px] font-bold leading-snug text-[#9a5555]">ล้าง session และกลับไปหน้าใส่รหัสร้าน</span>
                </span>
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
