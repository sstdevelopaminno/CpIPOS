"use client";

import { LoadingDialog } from "@/components/auth/loading-dialog";
import { ClipboardList, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

type HeldOrder = {
  id: string;
  orderNo: string;
  total: number;
  discount: number;
  itemCount: number;
  updatedAt: string | null;
  items: Array<{ name: string; quantity: number; lineTotal: number }>;
};

function money(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function normalizeSixDigitPin(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

function PinDigits({ value }: { value: string }) {
  return (
    <div className="grid grid-cols-6 gap-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <span key={index} className="grid min-h-[48px] place-items-center rounded-[14px] border border-[#ffd7d7] bg-white text-[20px] font-black text-[#0f2745]">
          {value[index] ? "*" : ""}
        </span>
      ))}
    </div>
  );
}

export function HeldOrdersLauncher({ heldCount = 0 }: { heldCount?: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<HeldOrder[]>([]);
  const [visibleCount, setVisibleCount] = useState(heldCount);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<HeldOrder | null>(null);
  const [cancelPin, setCancelPin] = useState("");
  const [cancelLoading, setCancelLoading] = useState(false);
  const [error, setError] = useState("");
  const [cancelError, setCancelError] = useState("");

  async function loadHeldOrders() {
    setOpen(true);
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/mobile/sales/takeaway/held", { cache: "no-store" });
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.error) {
        setError(json?.error?.message ?? "โหลดรายการพักไม่สำเร็จ");
        return;
      }
      const nextOrders = json?.data?.orders ?? [];
      setOrders(nextOrders);
      setVisibleCount(nextOrders.length);
    } finally {
      setLoading(false);
    }
  }

  async function restoreHeldOrder(orderId: string) {
    if (restoringId || cancelLoading) return;
    setRestoringId(orderId);
    setError("");
    try {
      const response = await fetch("/api/mobile/sales/takeaway/held/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.error) {
        setError(json?.error?.message ?? "เรียกบิลพักไม่สำเร็จ");
        return;
      }
      setOpen(false);
      router.push("/sales/takeaway");
      router.refresh();
    } finally {
      setRestoringId(null);
    }
  }

  async function cancelHeldOrder() {
    if (!cancelTarget || cancelPin.length !== 6 || cancelLoading) return;
    setCancelLoading(true);
    setCancelError("");
    try {
      const response = await fetch("/api/mobile/sales/takeaway/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: cancelTarget.id, pin: cancelPin }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || json?.error) {
        setCancelError(json?.error?.message ?? "ยกเลิกบิลไม่สำเร็จ");
        return;
      }
      setOrders((current) => {
        const next = current.filter((order) => order.id !== cancelTarget.id);
        setVisibleCount(next.length);
        return next;
      });
      setCancelTarget(null);
      setCancelPin("");
      router.refresh();
    } finally {
      setCancelLoading(false);
    }
  }

  return (
    <>
      <button type="button" onClick={loadHeldOrders} className="relative flex min-h-[58px] w-full touch-manipulation items-center justify-center gap-3 rounded-[18px] border border-[#d4e5f8] bg-white px-4 text-[18px] font-black text-[#17416f] shadow-[0_8px_20px_rgba(15,39,69,0.06)] transition active:scale-[0.99] active:bg-[#f5faff]">
        {visibleCount > 0 ? (
          <>
            <span className="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-[#ef4444] ring-2 ring-white" aria-hidden="true" />
            <span className="absolute -right-1 -top-2 grid min-h-6 min-w-6 place-items-center rounded-full bg-[#ef4444] px-1.5 text-[11px] font-black leading-none text-white shadow-[0_6px_12px_rgba(239,68,68,0.28)]" aria-label={`มีรายการพัก ${visibleCount} รายการ`}>
              {visibleCount > 99 ? "99+" : visibleCount}
            </span>
          </>
        ) : null}
        <ClipboardList className="h-6 w-6 text-[#1677d9]" />
        รายการพัก
      </button>

      {open ? (
        <div role="dialog" aria-modal="true" aria-label="รายการพัก" className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(15,39,69,0.35)] p-4">
          <section className="max-h-[76vh] w-[min(94vw,430px)] overflow-y-auto rounded-[22px] border border-[#d9e8f7] bg-[#f8fbff] p-4 shadow-[0_18px_48px_rgba(15,39,69,0.22)]">
            <header className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="m-0 text-[22px] font-black leading-tight text-[#0f2745]">รายการพัก</h2>
                <p className="m-0 mt-1 text-[13px] font-bold text-[#6a7f99]">{orders.length} รายการ</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="ปิด" className="flex h-11 w-11 min-h-11 items-center justify-center rounded-full border border-[#d9e8f7] bg-white text-[#17416f]">
                <X size={22} />
              </button>
            </header>

            {error ? <div className="rounded-[16px] border border-[#ffd7d7] bg-[#fff8f8] p-3 text-[14px] font-bold text-[#d62929]">{error}</div> : null}
            {loading ? <div className="p-5 text-center text-[15px] font-black text-[#587398]">กำลังโหลด...</div> : null}
            {!loading && !orders.length && !error ? <div className="rounded-[16px] border border-[#d9e8f7] bg-white p-5 text-center text-[15px] font-bold text-[#7a8fa8]">ยังไม่มีบิลที่พัก</div> : null}

            <div className="grid gap-3">
              {orders.map((order) => (
                <article key={order.id} className="rounded-[18px] border border-[#d9e8f7] bg-white p-4">
                  <div className="flex justify-between gap-3">
                    <div>
                      <b className="text-[15px] text-[#0f2745]">{order.orderNo}</b>
                      <p className="m-0 mt-1 text-[12px] font-semibold text-[#7a8fa8]">{order.updatedAt ? new Date(order.updatedAt).toLocaleString("th-TH") : "-"}</p>
                    </div>
                    <b className="text-[16px] text-[#1677d9]">฿{money(order.total)}</b>
                  </div>
                  <p className="m-0 mt-3 text-[13px] font-black text-[#587398]">{order.itemCount} รายการ</p>
                  <div className="mt-2 grid gap-1.5">
                    {order.items.slice(0, 3).map((item, index) => (
                      <div key={`${order.id}-${index}`} className="grid grid-cols-[1fr_auto] gap-2 text-[12px] text-[#334155]">
                        <span>{item.name} x {item.quantity}</span>
                        <b>฿{money(item.lineTotal)}</b>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-[1fr_52px] gap-2">
                    <button type="button" onClick={() => restoreHeldOrder(order.id)} disabled={Boolean(restoringId) || cancelLoading} className="min-h-[48px] rounded-[14px] border-0 bg-[#1677d9] text-[14px] font-black text-white">
                      {restoringId === order.id ? "กำลังเรียก..." : "เรียกกลับ"}
                    </button>
                    <button type="button" onClick={() => { setCancelTarget(order); setCancelPin(""); setCancelError(""); }} disabled={Boolean(restoringId) || cancelLoading} aria-label="ยกเลิกบิล" className="flex min-h-[48px] items-center justify-center rounded-[14px] border border-[#fecaca] bg-[#fff1f1] text-[#d62929]">
                      <Trash2 size={20} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {cancelTarget ? (
        <div role="dialog" aria-modal="true" aria-label="ยกเลิกบิลพัก" className="fixed inset-0 z-[90] flex items-center justify-center bg-[rgba(15,39,69,0.35)] p-4">
          <section className="w-[min(92vw,380px)] rounded-[22px] border border-[#ffd7d7] bg-white p-4 shadow-[0_18px_48px_rgba(15,39,69,0.22)]">
            <header className="flex items-center justify-between gap-2">
              <h2 className="m-0 text-[20px] font-black text-[#d62929]">ยกเลิกบิลพัก</h2>
              <button type="button" onClick={() => setCancelTarget(null)} aria-label="ปิด" className="flex h-10 w-10 min-h-10 items-center justify-center rounded-full border border-[#ffd7d7] bg-white text-[#d62929]">
                <X size={20} />
              </button>
            </header>
            <p className="m-0 mt-2 text-[13px] font-bold text-[#7a8fa8]">{cancelTarget.orderNo}</p>
            <label className="mt-4 grid gap-2 text-[13px] font-black text-[#7a8fa8]">
              ใส่ PIN ผู้มีสิทธิ์
              <input id="held-cancel-pin" value={cancelPin} onChange={(event) => setCancelPin(normalizeSixDigitPin(event.target.value))} type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="one-time-code" className="pointer-events-none absolute h-px w-px opacity-0" />
              <button type="button" onClick={() => document.getElementById("held-cancel-pin")?.focus()} className="border-0 bg-transparent p-0 text-left">
                <PinDigits value={cancelPin} />
              </button>
            </label>
            {cancelError ? <p className="m-0 mt-3 text-[13px] font-bold text-[#d62929]">{cancelError}</p> : null}
            <button type="button" onClick={cancelHeldOrder} disabled={cancelPin.length !== 6 || cancelLoading} className="mt-4 min-h-[52px] w-full rounded-[16px] border-0 bg-[#d62929] text-[16px] font-black text-white disabled:bg-[#f2a6a6]">
              {cancelLoading ? "กำลังยกเลิก..." : "ยืนยันยกเลิกบิล"}
            </button>
          </section>
        </div>
      ) : null}

      <LoadingDialog open={Boolean(restoringId)} title="กำลังเรียกบิลพัก" message="กำลังเปิดบิลกลับสู่หน้าแคชเชียร์..." />
      <LoadingDialog open={cancelLoading} title="กำลังยกเลิกบิล" message="กำลังตรวจ PIN และยกเลิกบิลพัก..." />
    </>
  );
}
