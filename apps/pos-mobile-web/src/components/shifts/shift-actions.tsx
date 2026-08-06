"use client";

import { LoadingDialog } from "@/components/auth/loading-dialog";
import { Banknote } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

function shiftErrorMessage(error: unknown) {
  if (error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message)) {
    const isLocal = typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    return isLocal
      ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจว่า npm run dev ยังเปิดอยู่ แล้วลองใหม่"
      : "เชื่อมต่อ API ไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่";
  }
  return error instanceof Error ? error.message : "ทำรายการปิดยอดไม่สำเร็จ";
}

async function logoutToBranchSelection() {
  const response = await fetch("/api/auth/session/logout", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    body: JSON.stringify({ action: "switch_branch" }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message ?? "ออกจากระบบไม่สำเร็จ");
  return json?.data?.redirectTo ?? "/login/branch";
}

function normalizeCashInput(value: string) {
  return value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 12);
}

function money(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ShiftActions({ hasOpenShift, expectedCash = 0 }: { hasOpenShift: boolean; expectedCash?: number }) {
  const router = useRouter();
  const [openingCash, setOpeningCash] = useState("");
  const [closingCash, setClosingCash] = useState("");
  const [loadingAction, setLoadingAction] = useState<"open" | "close" | null>(null);
  const [error, setError] = useState("");
  const loading = loadingAction !== null;
  const openingCashValue = openingCash.trim() === "" ? null : Number(openingCash);
  const closingCashValue = closingCash.trim() === "" ? null : Number(closingCash);
  const canOpen = openingCashValue !== null && Number.isFinite(openingCashValue) && openingCashValue >= 0 && !loading;
  const canClose = closingCashValue !== null && Number.isFinite(closingCashValue) && closingCashValue >= 0 && !loading;
  const closeDiff = closingCashValue === null || !Number.isFinite(closingCashValue) ? 0 : closingCashValue - expectedCash;

  async function submit(action: "open" | "close") {
    if (action === "open" && !canOpen) {
      setError("กรุณากรอกเงินทอนเริ่มต้น");
      return;
    }
    if (action === "close" && !canClose) {
      setError("กรุณากรอกเงินสดปิดกะ");
      return;
    }
    setLoadingAction(action);
    setError("");
    try {
      const res = await fetch("/api/mobile/shifts", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify({
          action,
          openingCash: action === "open" ? openingCashValue : undefined,
          closingCash: action === "close" ? closingCashValue : undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message ?? "ทำรายการปิดยอดไม่สำเร็จ");
      if (action === "close") {
        const redirectTo = await logoutToBranchSelection();
        router.replace(redirectTo);
        return;
      }
      const redirectTo = json?.data?.redirectTo ?? "/sales";
      router.push(redirectTo);
    } catch (err) {
      setError(shiftErrorMessage(err));
      setLoadingAction(null);
    }
  }

  return (
    <>
      <div className="space-y-4">
        {hasOpenShift ? (
          <div className="space-y-4">
            <label className="block space-y-2">
              <span className="flex items-center gap-2 text-[15px] font-black text-[#0f2745]">
                <Banknote className="h-5 w-5 text-[#1677d9]" />
                เงินสดปิดกะ
              </span>
              <input
                className="h-14 w-full rounded-[16px] border border-[#c9dbf2] bg-white px-4 text-[20px] font-black text-[#0f2745] outline-none focus:border-[#1677ff] focus:ring-2 focus:ring-[#d8eaff]"
                value={closingCash}
                onChange={(event) => setClosingCash(normalizeCashInput(event.target.value))}
                placeholder="0.00"
                inputMode="decimal"
                disabled={loading}
              />
            </label>
            <div className="rounded-[18px] bg-[#eef6ff] p-4 text-[15px]">
              <div className="flex items-center justify-between gap-3">
                <span className="font-black text-[#587398]">เงินสดคาดหวัง</span>
                <b className="text-[#0f2745]">{money(expectedCash)} ฿</b>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="font-black text-[#587398]">ส่วนต่าง</span>
                <b className={closeDiff === 0 ? "text-[#0f8d46]" : "text-[#d97706]"}>{money(closeDiff)} ฿</b>
              </div>
            </div>
            <button type="button" className="min-h-[56px] w-full rounded-[18px] border border-[#bcd5f5] bg-white px-4 text-[16px] font-black text-[#17416f] disabled:opacity-60" disabled={!canClose} onClick={() => submit("close")}>
              {loadingAction === "close" ? "กำลังปิดยอด..." : "ปิดยอด"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block space-y-2">
              <span className="flex items-center gap-2 text-[15px] font-black text-[#0f2745]">
                <Banknote className="h-5 w-5 text-[#1677d9]" />
                เงินทอนเริ่มต้น
              </span>
              <input
                className="h-14 w-full rounded-[16px] border border-[#c9dbf2] bg-white px-4 text-[20px] font-black text-[#0f2745] outline-none focus:border-[#1677ff] focus:ring-2 focus:ring-[#d8eaff]"
                value={openingCash}
                onChange={(event) => setOpeningCash(normalizeCashInput(event.target.value))}
                placeholder="0.00"
                inputMode="decimal"
                disabled={loading}
              />
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[0, 500, 1000, 2000].map((amount) => (
                <button key={amount} type="button" className="min-h-[48px] rounded-[14px] border border-[#c9dbf2] bg-white px-2 text-[13px] font-black text-[#17416f]" disabled={loading} onClick={() => setOpeningCash(String(amount))}>
                  {amount.toLocaleString()}
                </button>
              ))}
            </div>
            <button type="button" className="min-h-[58px] w-full rounded-[18px] bg-[#1677d9] px-4 text-[17px] font-black text-white disabled:cursor-not-allowed disabled:opacity-60" disabled={!canOpen} onClick={() => submit("open")}>
              {loadingAction === "open" ? "กำลังเปิดกะ..." : "เปิดกะและไปขาย"}
            </button>
          </div>
        )}
        {error ? <p className="text-[14px] font-bold text-red-600">{error}</p> : null}
      </div>
      <LoadingDialog open={loadingAction === "open"} title="กำลังเปิดกะ" message="กำลังบันทึกเงินทอนและเตรียมเมนูขาย..." />
      <LoadingDialog open={loadingAction === "close"} title="กำลังปิดยอด" message="กำลังปิดกะของเครื่องแคชเชียร์นี้..." />
    </>
  );
}
