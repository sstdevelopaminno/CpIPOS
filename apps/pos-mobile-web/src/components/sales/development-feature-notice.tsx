"use client";

import { Construction, User, X } from "lucide-react";
import { useState } from "react";

type DevelopmentIconName = "construction" | "user";

const developmentIcons = {
  construction: Construction,
  user: User,
} satisfies Record<DevelopmentIconName, typeof Construction>;

export function DevelopmentNoticeDialog({
  open,
  title,
  message,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[190] flex items-center justify-center bg-[rgba(15,39,69,0.35)] p-4">
      <section className="w-full max-w-[360px] rounded-[20px] border border-[#d9e8f7] bg-white p-4 shadow-[0_18px_48px_rgba(15,39,69,0.22)]">
        <div className="flex items-start justify-between gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-[#fff6e8] text-[#d98600]">
            <Construction size={25} />
          </span>
          <button type="button" onClick={onClose} aria-label="ปิด" className="grid min-h-9 w-9 shrink-0 place-items-center rounded-full border border-[#d9e8f7] bg-white text-[#17416f]">
            <X size={18} />
          </button>
        </div>
        <h2 className="m-0 mt-3 text-[20px] font-black leading-tight text-[#0f2745]">{title}</h2>
        <p className="m-0 mt-2 text-[13px] font-bold leading-snug text-[#587398]">{message}</p>
        <button type="button" onClick={onClose} className="mt-4 min-h-11 w-full rounded-[14px] border-0 bg-[#1677d9] px-4 text-[14px] font-black text-white">
          รับทราบ
        </button>
      </section>
    </div>
  );
}

export function DevelopmentFeatureButton({
  iconName = "construction",
  label,
  title,
  message,
}: {
  iconName?: DevelopmentIconName;
  label: string;
  title: string;
  message: string;
}) {
  const [open, setOpen] = useState(false);
  const Icon = developmentIcons[iconName];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[58px] min-w-0 items-center justify-center gap-2 rounded-[18px] border border-[#d4e5f8] bg-white px-3 text-[14px] font-black text-[#17416f] shadow-[0_8px_20px_rgba(15,39,69,0.06)] active:scale-[0.98] active:bg-[#f8fbff]"
      >
        <Icon size={21} className="shrink-0 text-[#1677d9]" />
        <span className="truncate">{label}</span>
      </button>
      <DevelopmentNoticeDialog open={open} title={title} message={message} onClose={() => setOpen(false)} />
    </>
  );
}
