"use client";

import { useEffect } from "react";
import type { OrderType } from "@pos/shared-types";

type ConfirmItem = {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string | null;
};

type Props = {
  open: boolean;
  lang: "th" | "en";
  orderType: OrderType;
  tableCode?: string | null;
  items: ConfirmItem[];
  total: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function money(value: number) {
  return `฿${new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.max(0, Number(value || 0)))}`;
}

export function PosKitchenOrderConfirmModal({
  open,
  lang,
  orderType,
  tableCode,
  items,
  total,
  busy = false,
  onCancel,
  onConfirm
}: Props) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  const isDineIn = orderType === "dine_in";
  const title = lang === "th" ? "ยืนยันส่งรายการเข้าครัว" : "Confirm kitchen order";
  const modeLabel = isDineIn
    ? (lang === "th" ? `นั่งโต๊ะ${tableCode ? ` · ${tableCode}` : ""}` : `Dine in${tableCode ? ` · ${tableCode}` : ""}`)
    : (lang === "th" ? "กลับบ้าน / Takeaway" : "Takeaway");

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="pos-kitchen-confirm-title">
      <button type="button" className="absolute inset-0 cursor-default" aria-label={lang === "th" ? "ปิด" : "Close"} disabled={busy} onClick={onCancel} />
      <section className="relative z-10 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <header className="border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.12em] text-amber-600">Kitchen confirmation</p>
              <h2 id="pos-kitchen-confirm-title" className="mt-1 text-2xl font-black text-slate-950">{title}</h2>
              <p className="mt-1 text-sm font-bold text-slate-500">{modeLabel}</p>
            </div>
            <span className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-black text-white">{items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} {lang === "th" ? "ชิ้น" : "items"}</span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
            {lang === "th"
              ? "กรุณาตรวจรายการอีกครั้ง เมื่อกดยืนยัน ระบบจะบันทึกออเดอร์ ส่งรายการเข้าครัว และสร้างงานพิมพ์ใบครัวตามเครื่องพิมพ์ที่ตั้งค่าไว้"
              : "Review the items before confirming. Confirming will save the order, route it to the kitchen, and queue the configured kitchen print jobs."}
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            <div className="max-h-[42vh] overflow-auto">
              <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-slate-100 text-xs font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{lang === "th" ? "รายการ" : "Item"}</th>
                    <th className="px-4 py-3 text-center">{lang === "th" ? "จำนวน" : "Qty"}</th>
                    <th className="px-4 py-3 text-right">{lang === "th" ? "ราคา" : "Price"}</th>
                    <th className="px-4 py-3 text-right">{lang === "th" ? "รวม" : "Total"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item, index) => (
                    <tr key={`${item.product_id}-${item.notes ?? ""}-${index}`}>
                      <td className="px-4 py-3">
                        <strong className="block text-slate-900">{item.name}</strong>
                        {item.notes ? <small className="mt-1 block text-xs font-semibold text-slate-500">{item.notes}</small> : null}
                      </td>
                      <td className="px-4 py-3 text-center text-lg font-black tabular-nums text-slate-900">{item.quantity}</td>
                      <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-600">{money(item.price)}</td>
                      <td className="px-4 py-3 text-right font-black tabular-nums text-slate-900">{money(item.price * item.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-900 px-5 py-4 text-white">
            <span className="text-sm font-bold">{lang === "th" ? "ยอดสุทธิ" : "Total"}</span>
            <strong className="text-2xl font-black tabular-nums">{money(total)}</strong>
          </div>
        </div>

        <footer className="grid grid-cols-2 gap-3 border-t border-slate-200 bg-white p-4">
          <button type="button" disabled={busy} onClick={onCancel} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
            {lang === "th" ? "กลับไปแก้รายการ" : "Back to cart"}
          </button>
          <button type="button" disabled={busy || items.length === 0} onClick={onConfirm} className="rounded-xl bg-emerald-600 px-4 py-3 text-base font-black text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? (lang === "th" ? "กำลังส่งเข้าครัว…" : "Sending…") : (lang === "th" ? "ยืนยันส่งเข้าครัวและพิมพ์" : "Confirm, send & print")}
          </button>
        </footer>
      </section>
    </div>
  );
}
