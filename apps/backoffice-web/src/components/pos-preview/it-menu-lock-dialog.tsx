"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Language } from "@/lib/i18n";

export function ItMenuLockDialog({ lang, open, menuLabel, onClose }: {
  lang: Language; open: boolean; menuLabel?: string; onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;
  const th = lang === "th";

  return createPortal(
    <div
      role="presentation"
      className="pointer-events-auto fixed inset-0 z-[300] grid place-items-center bg-slate-950/60 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="it-menu-lock-title"
        className="pointer-events-auto w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl"
      >
        <span aria-hidden className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>
          </svg>
        </span>
        <h2 id="it-menu-lock-title" className="mt-3 text-lg font-bold">
          {th ? "เมนูนี้ถูกล็อกโดยผู้ดูแลระบบ IT" : "This menu is locked by IT"}
        </h2>
        {menuLabel ? <p className="mt-2 font-semibold">{menuLabel}</p> : null}
        <p className="mt-2 text-sm text-slate-600">
          {th
            ? "ติดต่อผู้ดูแลระบบ IT หากต้องการเปิดใช้งานเมนูนี้ เมนูอื่นและข้อมูลร้านค้ายังคงใช้งานได้ตามปกติ"
            : "Contact your IT administrator to unlock this menu. Other menus and store data remain available."}
        </p>
        <button
          type="button"
          autoFocus
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }}
          className="pointer-events-auto mt-5 min-h-10 w-full rounded-xl bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          {th ? "รับทราบ" : "Got it"}
        </button>
      </section>
    </div>,
    document.body
  );
}
