"use client";

import Image from "next/image";

export function LoadingDialog({ open, title, message }: { open: boolean; title: string; message: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2745]/35 px-6 backdrop-blur-[1px]" role="alertdialog" aria-modal="true" aria-live="assertive">
      <div className="w-full max-w-[360px] rounded-[18px] bg-white px-6 py-7 text-center shadow-2xl shadow-slate-900/20">
        <div className="mb-4 flex justify-center">
          <Image src="/brand/cpipos-logo.png" alt="CpIPOS" width={96} height={68} className="h-auto w-[72px] object-contain" priority />
        </div>
        <div className="mx-auto mb-4 h-9 w-9 animate-spin rounded-full border-[3px] border-[#cfe5ff] border-t-[#1677d9]" />
        <h2 className="text-base font-bold text-[#0f2745]">{title}</h2>
        <p className="mt-2 text-sm text-[#587398]">{message}</p>
      </div>
    </div>
  );
}
