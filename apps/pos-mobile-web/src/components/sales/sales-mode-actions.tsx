"use client";

import { LoadingDialog } from "@/components/auth/loading-dialog";
import { DevelopmentNoticeDialog } from "@/components/sales/development-feature-notice";
import { Armchair, ShoppingBag, Truck, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type SalesModeKey = "takeaway" | "dineIn" | "delivery";

type SalesMode = {
  key: SalesModeKey;
  href: string;
  icon: LucideIcon;
  title: string;
  caption: string;
  tone: string;
  loadingMessage: string;
  development?: {
    title: string;
    message: string;
  };
};

export type SalesModeActivity = Partial<Record<SalesModeKey, boolean>>;

const modes: SalesMode[] = [
  { key: "takeaway", href: "/sales/takeaway", icon: ShoppingBag, title: "กลับบ้าน", caption: "เปิดออเดอร์", tone: "bg-[#eef6ff] text-[#1677d9]", loadingMessage: "กำลังเปิดออเดอร์กลับบ้าน..." },
  { key: "dineIn", href: "/sales/table", icon: Armchair, title: "เลือกโต๊ะ", caption: "เปิดโต๊ะลูกค้า", tone: "bg-[#fff6e8] text-[#d98600]", loadingMessage: "กำลังโหลดผังโต๊ะ..." },
  {
    key: "delivery",
    href: "/sales/delivery",
    icon: Truck,
    title: "เดลิเวอรี่",
    caption: "อยู่ระหว่างพัฒนา",
    tone: "bg-[#f2f0ff] text-[#6d5dfc]",
    loadingMessage: "กำลังโหลดออเดอร์เดลิเวอรี่...",
    development: {
      title: "เดลิเวอรี่อยู่ระหว่างพัฒนา",
      message: "ระบบเดลิเวอรี่ฝั่ง CpIPOS ยังอยู่ในโหมดพัฒนา Mobile จึงปิดการเปิดออเดอร์เดลิเวอรี่ชั่วคราวก่อน",
    },
  },
];

export function SalesModeActions({ activity = {} }: { activity?: SalesModeActivity }) {
  const router = useRouter();
  const [loading, setLoading] = useState<SalesMode | null>(null);
  const [notice, setNotice] = useState<SalesMode | null>(null);

  useEffect(() => {
    for (const mode of modes) {
      if (mode.href !== "/sales/takeaway" && !mode.development) router.prefetch(mode.href);
    }
  }, [router]);

  function openMode(mode: SalesMode) {
    if (loading) return;
    if (mode.development) {
      setNotice(mode);
      return;
    }
    setLoading(mode);
    if (mode.href === "/sales/takeaway") {
      window.location.assign(mode.href);
      return;
    }
    router.push(mode.href);
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const busy = loading?.href === mode.href;
          const active = Boolean(activity[mode.key]);
          return (
            <button
              key={mode.href}
              type="button"
              aria-label={active ? `${mode.title} มีรายการที่กำลังใช้งาน` : mode.title}
              className={`relative block min-h-[128px] touch-manipulation rounded-[18px] border border-[#d4e5f8] bg-white p-3.5 text-left shadow-[0_8px_20px_rgba(15,39,69,0.06)] transition active:scale-[0.98] active:bg-[#f5faff] disabled:opacity-70 ${busy ? "ring-2 ring-[#9dccff]" : ""}`}
              onClick={() => openMode(mode)}
              disabled={Boolean(loading)}
            >
              {active ? <span aria-hidden="true" className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-[#ef4444] shadow-[0_0_0_4px_rgba(239,68,68,0.12)]" /> : null}
              <span className={`mb-4 flex h-11 w-11 items-center justify-center rounded-[16px] ${mode.tone}`}>
                <Icon size={24} strokeWidth={2.3} />
              </span>
              <span className="block text-[15px] font-black leading-tight text-[#0f2745]">{mode.title}</span>
              <span className="mt-1.5 block text-[12px] font-semibold leading-snug text-[#6a7f99]">{busy ? "กำลังเปิด..." : mode.caption}</span>
            </button>
          );
        })}
      </div>
      <LoadingDialog open={Boolean(loading)} title="กำลังเปิดเมนู" message={loading?.loadingMessage ?? "กำลังโหลดข้อมูล..."} />
      <DevelopmentNoticeDialog
        open={Boolean(notice?.development)}
        title={notice?.development?.title ?? ""}
        message={notice?.development?.message ?? ""}
        onClose={() => setNotice(null)}
      />
    </>
  );
}