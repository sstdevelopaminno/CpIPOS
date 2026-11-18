"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

type FinanceDialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  busy?: boolean;
  tone?: "primary" | "danger";
  size?: "sm" | "lg" | "xl";
};

export function FinanceDialog({
  open, onClose, title, description, children, busy = false,
  tone = "primary", size = "lg"
}: FinanceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [open]);

  const dismiss = () => { if (!busy) onClose(); };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      aria-modal="true"
      onCancel={(event) => { event.preventDefault(); dismiss(); }}
      onClick={(event) => { if (event.target === event.currentTarget) dismiss(); }}
      className={
        "m-auto w-[calc(100%-24px)] overflow-hidden rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 " +
        "shadow-[0_28px_90px_rgba(4,27,57,0.30)] backdrop:bg-slate-950/60 backdrop:backdrop-blur-[3px] " +
        (size === "sm" ? "max-w-md" : size === "xl" ? "max-w-5xl" : "max-w-3xl")
      }
    >
      <section className="flex max-h-[min(92dvh,900px)] min-h-0 flex-col">
        <header className="flex shrink-0 items-start gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
          <span aria-hidden="true" className={
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl " +
            (tone === "danger" ? "bg-rose-100 text-rose-700" : "bg-blue-100 text-blue-700")
          }>
            {tone === "danger" ? (
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.6L13.7 3.9a2 2 0 0 0-3.4 0Z"/>
                <path d="M12 9v4M12 17h.01"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>
              </svg>
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-extrabold leading-6 text-slate-900 sm:text-lg">{title}</h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-xs leading-5 text-slate-600 sm:text-sm">{description}</p>
            ) : null}
          </div>
          <button type="button" aria-label="ปิดหน้าต่าง" title="ปิดหน้าต่าง"
            disabled={busy} onClick={dismiss}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-40">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18"/>
            </svg>
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          {children}
        </div>
      </section>
    </dialog>
  );
}

export function FinanceConfirmDialog({
  open, onClose, onConfirm, title, description, confirmLabel, busy = false,
  danger = false, children, confirmDisabled = false
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <FinanceDialog open={open} onClose={onClose} busy={busy} title={title}
      description={description} size="sm" tone={danger ? "danger" : "primary"}>
      {children}
      <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" autoFocus disabled={busy} onClick={onClose}
          className="min-h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          ยกเลิก
        </button>
        <button type="button" disabled={busy || confirmDisabled} onClick={onConfirm}
          className={
            "min-h-10 rounded-lg px-5 text-sm font-bold text-white shadow-sm disabled:cursor-wait disabled:opacity-50 " +
            (danger ? "bg-rose-700 hover:bg-rose-800" : "bg-blue-700 hover:bg-blue-800")
          }>
          {busy ? "กำลังดำเนินการ..." : confirmLabel}
        </button>
      </div>
    </FinanceDialog>
  );
}
