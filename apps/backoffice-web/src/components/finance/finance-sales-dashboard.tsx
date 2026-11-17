"use client";

import { useEffect, useState } from "react";
import { formatSalesMoney, type SalesCurrencyCode } from "@/lib/pos-money";
import type { FinanceSalesReport } from "@/lib/server/finance-sales-report-service";

type FinanceActor = "owner" | "accountant";
type ApiResult = { data?: FinanceSalesReport | null; error?: { code?: string; message?: string } | null };

function bangkokDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}
function rangeStart(days: number): string {
  const date = new Date(Date.now() - (days - 1) * 86_400_000);
  return bangkokDate(date);
}
function formatted(value: number, currency: SalesCurrencyCode) {
  return formatSalesMoney(value, currency, "th-TH");
}
function methodLabel(value: string) {
  const labels: Record<string, string> = {
    cash: "เงินสด", bank_transfer: "เงินโอน", qr: "QR", card: "บัตร",
    promptpay: "พร้อมเพย์", unknown: "ไม่ระบุ"
  };
  return labels[value] || value;
}
function displayDate(value: string) {
  return new Date(value).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok", day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
}
const dateClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const panel = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5";

export function FinanceSalesDashboard({ actor }: { actor: FinanceActor }) {
  const [from, setFrom] = useState(() => rangeStart(7));
  const [to, setTo] = useState(() => bangkokDate());
  const [branchId, setBranchId] = useState("");
  const [report, setReport] = useState<FinanceSalesReport | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setBusy(true);
      setError("");
      try {
        const qs = new URLSearchParams({ actor, from, to });
        if (branchId) qs.set("branchId", branchId);
        const response = await fetch("/api/finance/sales-overview?" + qs.toString(), {
          cache: "no-store", credentials: "same-origin", signal: controller.signal
        });
        const result = await response.json().catch(() => null) as ApiResult | null;
        if (!response.ok || !result?.data) {
          const reasons: Record<string, string> = {
            finance_date_range_too_large: "เลือกช่วงเวลาได้ไม่เกิน 31 วันต่อครั้ง",
            finance_invalid_date: "กรุณาเลือกวันที่ให้ถูกต้อง",
            finance_report_too_many_sales_narrow_dates: "มีรายการจำนวนมาก กรุณาลดช่วงวันที่",
            finance_payments_too_many_narrow_dates: "มีรายการชำระจำนวนมาก กรุณาลดช่วงวันที่",
            finance_branch_not_permitted: "ไม่มีสิทธิ์ดูข้อมูลสาขาที่เลือก",
            finance_session_required: "กรุณาเข้าสู่ระบบฝ่ายบัญชีใหม่",
            finance_package_required: "แพ็กเกจนี้ยังไม่รองรับเมนูการเงิน",
            finance_menu_disabled: "เมนูการเงินถูกปิดโดยฝ่าย IT"
          };
          throw new Error(reasons[result?.error?.code ?? ""] ||
            "ไม่สามารถโหลดข้อมูลการเงินได้ กรุณาตรวจสอบ Session และลองใหม่");
        }
        setReport(result.data);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setReport(null);
          setError(cause instanceof Error ? cause.message : "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์");
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [actor, from, to, branchId, reload]);

  return (
    <div className="space-y-5">
      <div className={panel}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">Finance Dashboard</h2>
            <p className="mt-1 text-xs text-slate-500">อ่านข้อมูล POS จริงทุกสาขาที่มีสิทธิ์ · ตามวันรับชำระสำเร็จ (เวลาไทย)</p>
          </div>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">READ ONLY · ไม่เปลี่ยนยอดขาย</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-semibold text-slate-600">วันที่เริ่มต้น
            <input aria-label="วันที่เริ่มต้น" type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} className={"mt-1 " + dateClass}/>
          </label>
          <label className="text-xs font-semibold text-slate-600">วันที่สิ้นสุด
            <input aria-label="วันที่สิ้นสุด" type="date" value={to} min={from} onChange={event => setTo(event.target.value)} className={"mt-1 " + dateClass}/>
          </label>
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">สาขา
            <select aria-label="เลือกสาขา" value={branchId} onChange={event => setBranchId(event.target.value)} className={"mt-1 " + dateClass}>
              <option value="">ทุกสาขาที่ได้รับสิทธิ์</option>
              {(report?.branches ?? []).map(branch =>
                <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>
              )}
            </select>
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <button type="button" onClick={() => { setFrom(bangkokDate()); setTo(bangkokDate()); }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50">วันนี้</button>
            <button type="button" onClick={() => { setFrom(rangeStart(7)); setTo(bangkokDate()); }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50">7 วัน</button>
            <button type="button" onClick={() => setReload(value => value + 1)}
              disabled={busy} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-60">
              {busy ? "กำลังอ่าน..." : "อัปเดต"}
            </button>
          </div>
        </div>
      </div>

      {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</div> : null}
      {busy && !report ? <div role="status" className={panel}>กำลังโหลดข้อมูลรายรับจากการขาย...</div> : null}
      {report ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>ช่วงวันที่ {report.range.from} ถึง {report.range.to} · {report.scannedCompletedOrders.toLocaleString("th-TH")} บิลสำเร็จ</span>
            <span>{busy ? "กำลังอัปเดตข้อมูล" : "รายงานล่าสุดจากเซิร์ฟเวอร์"}</span>
          </div>
          {report.totals.length === 0 ? (
            <div className={panel}>
              <h3 className="text-lg font-bold">ยังไม่มีบิลขายสำเร็จในช่วงเวลาที่เลือก</h3>
              <p className="mt-2 text-sm text-slate-500">ลองเปลี่ยนช่วงวันที่หรือสาขา รายงานจะไม่แสดงยอดสมมติ</p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-3">
              {report.totals.map(total => (
                <section key={total.currency} className={panel}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-bold text-slate-900">ยอดขาย {total.currency}</h3>
                    <span className="text-xs text-slate-500">{total.bills.toLocaleString("th-TH")} บิล</span>
                  </div>
                  <p className="mt-3 text-xs font-semibold text-slate-500">ยอดตามบิลสำเร็จ</p>
                  <p className="mt-1 break-all text-2xl font-black tabular-nums text-blue-800">{formatted(total.billed, total.currency)}</p>
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <p className="text-xs text-slate-500">ยอดรับชำระที่บันทึก (สถานะ paid)</p>
                    <p className="mt-1 text-xl font-extrabold tabular-nums text-emerald-700">{formatted(total.received, total.currency)}</p>
                    <p className={"mt-2 text-xs " + (total.unmatchedBills ? "font-semibold text-amber-700" : "text-slate-500")}>
                      {total.unmatchedBills > 0 ? `มี ${total.unmatchedBills} บิลที่ยอดรับชำระไม่ตรงกับยอดบิล` : "ไม่พบส่วนต่างยอดบิลกับรายการรับชำระ"}
                    </p>
                  </div>
                </section>
              ))}
            </div>
          )}
          <div className="grid gap-4 xl:grid-cols-2">
            <section className={panel}>
              <h3 className="mb-3 text-lg font-bold">รายรับตามวัน (ยอดชำระที่บันทึก)</h3>
              {report.totals.map(total => {
                const days = report.daily.filter(day => day.currency === total.currency);
                const maxValue = Math.max(1, ...days.map(day => day.received));
                return (
                  <div key={total.currency} className="mb-5 space-y-2">
                    <p className="text-xs font-bold text-slate-600">{total.currency}</p>
                    {days.map(day => (
                      <div key={day.date} className="grid grid-cols-[75px_1fr_auto] items-center gap-2 text-xs">
                        <span className="text-slate-600">{day.date.slice(5)}</span>
                        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, Math.max(0, day.received / maxValue * 100))}%` }} />
                        </div>
                        <span className="whitespace-nowrap font-semibold tabular-nums">{formatted(day.received, total.currency)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
              {report.daily.length === 0 ? <p className="text-sm text-slate-500">ไม่มีรายการในช่วงเวลานี้</p> : null}
            </section>
            <section className={panel}>
              <h3 className="mb-3 text-lg font-bold">รับชำระแยกตามช่องทาง</h3>
              <div className="space-y-3">
                {report.methods.map(item => (
                  <div key={item.currency + ":" + item.method} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3 text-sm">
                    <div><p className="font-semibold">{methodLabel(item.method)} · {item.currency}</p>
                      <p className="text-xs text-slate-500">{item.transactions.toLocaleString("th-TH")} รายการรับชำระ</p>
                    </div>
                    <p className="whitespace-nowrap font-bold tabular-nums">{formatted(item.received, item.currency)}</p>
                  </div>
                ))}
                {report.methods.length === 0 ? <p className="text-sm text-slate-500">ไม่มีรายการรับชำระที่บันทึกเป็น paid</p> : null}
              </div>
            </section>
          </div>
          <section className={panel}>
            <h3 className="mb-3 text-lg font-bold">สรุปตามสาขา</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[580px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs text-slate-500"><tr>
                  <th className="py-3">สาขา</th><th>สกุลเงิน</th><th className="text-right">จำนวนบิล</th>
                  <th className="text-right">ยอดขาย</th><th className="text-right">รับชำระ</th>
                </tr></thead>
                <tbody>{report.byBranch.map(row => (
                  <tr key={row.branchId + ":" + row.currency} className="border-b border-slate-100">
                    <td className="py-3 font-semibold">{row.branchName}</td><td>{row.currency}</td>
                    <td className="text-right">{row.bills.toLocaleString("th-TH")}</td>
                    <td className="text-right tabular-nums">{formatted(row.billed, row.currency)}</td>
                    <td className="text-right tabular-nums">{formatted(row.received, row.currency)}</td>
                  </tr>
                ))}</tbody>
              </table>
              {report.byBranch.length === 0 ? <p className="py-4 text-sm text-slate-500">ไม่มีบิลขายสำเร็จ</p> : null}
            </div>
          </section>
          <section className={panel}>
            <h3 className="mb-3 text-lg font-bold">รายการขายที่รับชำระสำเร็จล่าสุด</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs text-slate-500"><tr>
                  <th className="py-3">วันที่ / เลขบิล</th><th>สาขา</th><th className="text-right">ยอดบิล</th>
                  <th className="text-right">รับชำระ</th><th>ช่องทาง</th><th>ตรวจสอบ</th>
                </tr></thead>
                <tbody>{report.recent.map(row => (
                  <tr key={row.orderId} className="border-b border-slate-100">
                    <td className="py-3"><span className="block text-xs text-slate-500">{displayDate(row.completedAt)}</span><span className="font-semibold">{row.orderNo}</span></td>
                    <td>{row.branchName}</td>
                    <td className="text-right tabular-nums">{formatted(row.billed, row.currency)}</td>
                    <td className="text-right tabular-nums">{formatted(row.received, row.currency)}</td>
                    <td className="text-xs">{row.methods.map(methodLabel).join(", ") || "ไม่พบรายการรับชำระ"}</td>
                    <td>{row.unmatched ? <span className="text-xs font-bold text-amber-700">ยอดไม่ตรง</span> : <span className="text-xs text-emerald-700">ตรงกัน</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
              {report.recent.length === 0 ? <p className="py-4 text-sm text-slate-500">ไม่มีรายการล่าสุด</p> : null}
            </div>
          </section>
          <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-bold text-slate-800">ขอบเขตตัวเลข</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-600">
              {report.notes.map(note => <li key={note}>{note}</li>)}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
