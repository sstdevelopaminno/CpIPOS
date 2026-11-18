"use client";

import { useEffect, useState } from "react";
import { formatSalesMoney, type SalesCurrencyCode } from "@/lib/pos-money";
import type { FinanceSalesReport } from "@/lib/server/finance-sales-report-service";
import { FinanceSalesRecordsTable, financePaymentMethodLabel } from "./finance-sales-records-table";

type FinanceActor = "owner" | "accountant";
type FinanceTab = "dashboard" | "sales" | "branches" | "methods" | "reconcile";
type ResponseData = { data?: FinanceSalesReport | null; error?: { code?: string; message?: string } | null };
type Search = {
  from: string; to: string; branchId: string; billNo: string;
  method: string; reconciliation: string; pageSize: string;
};
const tabs: { id: FinanceTab; label: string }[] = [
  { id: "dashboard", label: "ภาพรวมการเงิน" },
  { id: "sales", label: "รายรับจากการขาย" },
  { id: "branches", label: "สรุปตามสาขา" },
  { id: "methods", label: "ช่องทางรับชำระ" },
  { id: "reconcile", label: "ตรวจสอบยอด" }
];
const inputClass = "mt-1 h-9 w-full min-w-0 rounded border border-[#cbd7e7] bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-200";
const actionClass = "rounded border border-[#b7cbe5] bg-white px-3 py-2 text-xs font-bold text-[#194879] hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40";

function thaiDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const piece = (name: string) => parts.find(part => part.type === name)?.value ?? "";
  return piece("year") + "-" + piece("month") + "-" + piece("day");
}
function initialSearch(days = 7): Search {
  const now = new Date();
  return {
    from: thaiDate(new Date(now.getTime() - (days - 1) * 86_400_000)),
    to: thaiDate(now), branchId: "", billNo: "",
    method: "all", reconciliation: "all", pageSize: "20"
  };
}
function value(value: number, currency: SalesCurrencyCode) {
  return formatSalesMoney(value, currency, "th-TH");
}
function csvCell(raw: string | number): string {
  const text = String(raw);
  const safe = /^[\s]*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}
function exportPage(report: FinanceSalesReport) {
  if (report.table.rows.length === 0) return;
  const rows: Array<Array<string | number>> = [
    ["วันที่รับชำระ (Asia/Bangkok)", "เลขบิล", "สาขา", "ช่องทาง", "สกุลเงิน",
      "ยอดบิล", "รับชำระ", "ส่วนต่าง", "สถานะตรวจสอบ"]
  ];
  for (const row of report.table.rows) {
    rows.push([
      new Date(row.completedAt).toLocaleString("sv-SE", { timeZone: "Asia/Bangkok" }),
      row.orderNo, row.branchName, row.methods.join(" + "), row.currency,
      row.billed, row.received, row.billed - row.received,
      row.methods.length === 0 ? "ไม่พบรายการชำระ" : row.unmatched ? "ยอดไม่ตรง" : "ยอดตรงกัน"
    ]);
  }
  const csv = "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = "cpipos-finance-" + report.range.from + "-page-" + report.table.page + ".csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}
function currencyTotals(report: FinanceSalesReport) {
  return report.totals;
}

export function FinanceSalesDashboard({
  actor, initialTab = "dashboard"
}: { actor: FinanceActor; initialTab?: FinanceTab }) {
  const [tab, setTab] = useState<FinanceTab>(initialTab);
  const [draft, setDraft] = useState<Search>(() => initialSearch());
  const [applied, setApplied] = useState<Search>(() => initialSearch());
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [report, setReport] = useState<FinanceSalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function apply(next: Search = draft) {
    setApplied({ ...next });
    setPage(1);
    setReload(value => value + 1);
  }
  function selectRange(days: number) {
    const next = { ...draft, ...initialSearch(days), branchId: draft.branchId,
      billNo: draft.billNo, method: draft.method, reconciliation: draft.reconciliation,
      pageSize: draft.pageSize };
    setDraft(next);
    apply(next);
  }
  function selectTab(next: FinanceTab) {
    setTab(next);
    if (next === "reconcile" && applied.reconciliation !== "unmatched") {
      const nextFilters = { ...draft, reconciliation: "unmatched" };
      setDraft(nextFilters);
      apply(nextFilters);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          actor, from: applied.from, to: applied.to, page: String(page),
          pageSize: applied.pageSize, method: applied.method,
          reconciliation: applied.reconciliation
        });
        if (applied.branchId) params.set("branchId", applied.branchId);
        if (applied.billNo) params.set("billNo", applied.billNo);
        const response = await fetch("/api/finance/sales-overview?" + params.toString(), {
          cache: "no-store", credentials: "same-origin", signal: controller.signal
        });
        const result = await response.json().catch(() => null) as ResponseData | null;
        if (!response.ok || !result?.data) {
          const messages: Record<string, string> = {
            finance_date_range_too_large: "เลือกช่วงวันที่ได้ไม่เกิน 31 วัน",
            finance_invalid_date: "ช่วงวันที่ไม่ถูกต้อง",
            finance_invalid_record_filter: "เงื่อนไขการค้นหาไม่ถูกต้อง",
            finance_report_too_many_sales_narrow_dates: "มีบิลมากเกินช่วงที่ระบบอ่านได้ กรุณาลดช่วงวันที่",
            finance_payments_too_many_narrow_dates: "รายการชำระจำนวนมาก กรุณาลดช่วงวันที่",
            finance_branch_not_permitted: "ไม่มีสิทธิ์อ่านข้อมูลสาขาที่เลือก",
            finance_session_required: "Session ฝ่ายบัญชีหมดอายุ กรุณาเข้าสู่ระบบใหม่",
            finance_owner_required: "เฉพาะเจ้าของร้านที่ได้รับสิทธิ์",
            finance_owner_scope_required: "ยังไม่ได้กำหนดสิทธิ์ Owner ในสาขาที่เข้าระบบ",
            finance_package_required: "เมนูการเงินเปิดเฉพาะแพ็กเกจ Business และ CUSTOM",
            finance_menu_disabled: "ฝ่าย IT ปิดเมนูการเงินของร้านนี้"
          };
          throw new Error(messages[result?.error?.code ?? ""] ??
            "อ่านข้อมูลการเงินไม่ได้ กรุณาตรวจสอบสิทธิ์หรือกดรีเฟรช");
        }
        setReport(result.data);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setReport(null);
          setError(cause instanceof Error ? cause.message : "เชื่อมต่อรายงานไม่ได้");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [actor, applied, page, reload]);

  const totals = report ? currencyTotals(report) : [];
  const showGrid = tab === "dashboard" || tab === "sales" || tab === "reconcile";
  return (
    <div className="w-full min-w-0 space-y-3 text-slate-900">
      <div className={"overflow-hidden border border-[#c5d4e7] bg-white shadow-sm " + (actor === "accountant" ? "rounded-none border-x-0 border-t-0" : "rounded-lg")}>
        <nav aria-label="หมวดการเงิน" className="flex min-h-[48px] flex-wrap items-end gap-0.5 overflow-x-auto bg-[#155c94] px-2 pt-1">
          <div className="flex min-h-10 shrink-0 items-center gap-2 px-3 text-xs font-black text-white">
            <span>CpiPOS FINANCE</span>
            <span className="border-l border-white/30 pl-2 font-semibold">{actor === "owner" ? "เจ้าของร้าน" : "ฝ่ายบัญชี"}</span>
          </div>
          <span className="ml-auto self-center rounded border border-white/25 px-2 py-1 text-[10px] font-semibold text-white/90">
            อ่านอย่างเดียว · READ ONLY
          </span>
          {tabs.map(item => (
            <button type="button" key={item.id} onClick={() => selectTab(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              className={"whitespace-nowrap rounded-t px-4 py-2.5 text-xs font-bold transition-colors " +
                (tab === item.id ? "bg-white text-[#0e497d]" : "text-blue-50 hover:bg-white/10")}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#cbd7e8] bg-[#edf3fa] px-3 py-2">
          <span className="mr-2 text-xs font-bold text-[#194879]">คำสั่ง</span>
          <button type="button" onClick={() => selectRange(1)} className={actionClass}>วันนี้</button>
          <button type="button" onClick={() => selectRange(7)} className={actionClass}>7 วัน</button>
          <button type="button" onClick={() => setReload(n => n + 1)} disabled={loading} className={actionClass}>
            {loading ? "กำลังโหลด…" : "รีเฟรช"}
          </button>
          <button type="button" disabled={!report || report.table.rows.length === 0}
            onClick={() => { if (report) exportPage(report); }} className={actionClass}
            title="ส่งออกเฉพาะรายการในตารางหน้าปัจจุบัน ไม่ใช่งบการเงิน">
            ส่งออก CSV (หน้านี้)
          </button>
          <span className="ml-auto text-[11px] text-slate-500">ข้อมูลตามบิล completed · เวลา Asia/Bangkok</span>
        </div>
        <form onSubmit={event => { event.preventDefault(); apply(); }} className="p-3 md:p-4">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3 md:grid-cols-4 xl:grid-cols-7">
            <label className="text-xs font-semibold text-[#395878]">จากวันที่
              <input type="date" aria-label="จากวันที่" className={inputClass} value={draft.from}
                onChange={event => setDraft(old => ({ ...old, from: event.target.value }))} />
            </label>
            <label className="text-xs font-semibold text-[#395878]">ถึงวันที่
              <input type="date" aria-label="ถึงวันที่" className={inputClass} value={draft.to}
                onChange={event => setDraft(old => ({ ...old, to: event.target.value }))} />
            </label>
            <label className="text-xs font-semibold text-[#395878]">สาขา
              <select className={inputClass} aria-label="สาขา" value={draft.branchId}
                onChange={event => setDraft(old => ({ ...old, branchId: event.target.value }))}>
                <option value="">ทุกสาขาที่ได้รับสิทธิ์</option>
                {(report?.branches ?? []).map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-[#395878]">เลขที่บิล
              <input type="search" maxLength={80} className={inputClass} aria-label="เลขที่บิล"
                placeholder="ค้นหาเลขบิล" value={draft.billNo}
                onChange={event => setDraft(old => ({ ...old, billNo: event.target.value }))} />
            </label>
            <label className="text-xs font-semibold text-[#395878]">ช่องทางรับชำระ
              <select className={inputClass} aria-label="ช่องทางรับชำระ" value={draft.method}
                onChange={event => setDraft(old => ({ ...old, method: event.target.value }))}>
                <option value="all">ทั้งหมด</option>
                {(report?.availableMethods ?? []).map(method => (
                  <option key={method} value={method}>{financePaymentMethodLabel(method)}</option>
                ))}
                {draft.method !== "all" && !report?.availableMethods.includes(draft.method) ? (
                  <option value={draft.method}>{financePaymentMethodLabel(draft.method)}</option>
                ) : null}
              </select>
            </label>
            <label className="text-xs font-semibold text-[#395878]">สถานะตรวจสอบ
              <select className={inputClass} aria-label="สถานะตรวจสอบ" value={draft.reconciliation}
                onChange={event => setDraft(old => ({ ...old, reconciliation: event.target.value }))}>
                <option value="all">ทุกสถานะ</option>
                <option value="matched">ยอดตรงกัน</option>
                <option value="unmatched">ยอดไม่ตรงกัน</option>
                <option value="missing_payment">ไม่พบรายการชำระ</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-[#395878]">ต่อหน้า
              <select className={inputClass} aria-label="รายการต่อหน้า" value={draft.pageSize}
                onChange={event => setDraft(old => ({ ...old, pageSize: event.target.value }))}>
                <option value="20">20 รายการ</option>
                <option value="50">50 รายการ</option>
              </select>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={loading}
              className="rounded bg-[#1264ac] px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#0b4c87] disabled:opacity-60">
              ค้นหา
            </button>
            <button type="button" className={actionClass}
              onClick={() => { const next = initialSearch(); setDraft(next); apply(next); setTab("dashboard"); }}>ล้างตัวกรอง</button>
            <span className="text-[11px] text-slate-500">
              เงื่อนไขเลขบิล ช่องทาง และสถานะใช้กับตาราง · ยอดสรุปคำนวณตามช่วงวันที่และสาขา
            </span>
          </div>
        </form>
      </div>

      {error ? <div role="alert" className="rounded border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</div> : null}
      {loading && !report ? <p role="status" className="rounded border border-slate-200 bg-white p-5 text-sm">กำลังตรวจสิทธิ์และอ่านยอดขายจาก POS…</p> : null}
      {report ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>วันที่ {report.range.from} – {report.range.to} · อ่านบิลสำเร็จ {report.scannedCompletedOrders.toLocaleString("th-TH")} บิล · สาขาที่ได้รับสิทธิ์ {report.branches.length}</span>
            <span>{loading ? "กำลังรีเฟรช…" : "ข้อมูลล่าสุดจากเซิร์ฟเวอร์ · ไม่แก้ไขรายการ"}</span>
          </div>
          {tab === "dashboard" || tab === "reconcile" ? (
            <div className={totals.length === 1 ? "grid grid-cols-1 gap-3" : totals.length === 2 ? "grid grid-cols-1 gap-3 lg:grid-cols-2" : "grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"}>
              {totals.map(total => (
                <section key={total.currency} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-[#f1f5fb] px-4 py-2">
                    <h3 className="text-xs font-black text-[#204a78]">สรุปยอด {total.currency}</h3>
                    <span className="text-[11px] text-slate-500">{total.bills.toLocaleString("th-TH")} บิล</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 p-4">
                    <div><p className="text-[11px] text-slate-500">ยอดตามบิล</p>
                      <p className="mt-1 break-all text-xl font-extrabold tabular-nums text-blue-800">{value(total.billed, total.currency)}</p></div>
                    <div><p className="text-[11px] text-slate-500">รับชำระที่บันทึก</p>
                      <p className="mt-1 break-all text-xl font-extrabold tabular-nums text-emerald-700">{value(total.received, total.currency)}</p></div>
                    <div className="col-span-2 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                      <span className="text-slate-500">บิลที่ยอดไม่ตรงกัน</span>
                      <span className={total.unmatchedBills ? "font-bold text-amber-800" : "font-semibold text-emerald-700"}>{total.unmatchedBills.toLocaleString("th-TH")} บิล</span>
                    </div>
                  </div>
                </section>
              ))}
              {totals.length === 0 ? (
                <div className="rounded border border-slate-200 bg-white p-5 text-sm text-slate-500">
                  ไม่มีบิลขายสำเร็จในช่วงเวลาที่เลือก ยอดสรุปจะแสดงเมื่อมีข้อมูลจริง
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "dashboard" ? (
            <div className="grid min-w-0 gap-3 lg:grid-cols-2">
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-bold">ยอดรับชำระรายวัน</h3>
                {totals.map(total => {
                  const entries = report.daily.filter(day => day.currency === total.currency);
                  const peak = Math.max(1, ...entries.map(day => day.received));
                  return (
                    <div key={total.currency} className="mb-3 space-y-1.5">
                      <p className="text-[11px] font-bold text-slate-600">{total.currency}</p>
                      {entries.map(day => (
                        <div key={day.date} className="grid grid-cols-[55px_1fr_auto] items-center gap-2 text-xs">
                          <span className="tabular-nums text-slate-600">{day.date.slice(5)}</span>
                          <div className="h-2 overflow-hidden rounded-sm bg-slate-100">
                            <div className="h-full bg-[#2673bd]" style={{ width: Math.min(100, Math.max(0, day.received / peak * 100)) + "%" }} />
                          </div>
                          <span className="tabular-nums">{value(day.received, total.currency)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
                {report.daily.length === 0 ? <p className="text-xs text-slate-500">ไม่มีข้อมูลรายวัน</p> : null}
              </section>
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-bold">สรุปช่องทางชำระ</h3>
                <div className="space-y-2">
                  {report.methods.map(method => (
                    <div key={method.currency + method.method} className="flex justify-between gap-2 border-b border-slate-100 pb-2 text-xs">
                      <span>{financePaymentMethodLabel(method.method)} · {method.currency} <span className="text-slate-400">({method.transactions} รายการ)</span></span>
                      <b className="whitespace-nowrap tabular-nums">{value(method.received, method.currency)}</b>
                    </div>
                  ))}
                  {report.methods.length === 0 ? <p className="text-xs text-slate-500">ไม่มีข้อมูลช่องทางรับชำระ</p> : null}
                </div>
              </section>
            </div>
          ) : null}

          {showGrid ? (
            <FinanceSalesRecordsTable table={report.table} busy={loading} onPageChange={setPage} />
          ) : null}

          {tab === "branches" ? (
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <h3 className="border-b bg-slate-50 px-4 py-3 text-sm font-bold">รายงานยอดขายแยกสาขา</h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[670px] text-xs">
                  <thead className="bg-[#eaf1fb] text-[#19385c]"><tr>
                    <th className="px-3 py-3 text-left">สาขา</th><th className="px-3 py-3 text-center">สกุลเงิน</th>
                    <th className="px-3 py-3 text-right">จำนวนบิล</th><th className="px-3 py-3 text-right">ยอดบิล</th>
                    <th className="px-3 py-3 text-right">รับชำระ</th><th className="px-3 py-3 text-right">ยอดไม่ตรง</th>
                  </tr></thead><tbody>
                    {report.byBranch.map(item => <tr key={item.branchId + item.currency} className="border-b border-slate-100 even:bg-[#f7faff]">
                      <td className="px-3 py-3 font-semibold">{item.branchName}</td><td className="text-center">{item.currency}</td>
                      <td className="px-3 text-right tabular-nums">{item.bills}</td>
                      <td className="px-3 text-right tabular-nums">{value(item.billed, item.currency)}</td>
                      <td className="px-3 text-right tabular-nums">{value(item.received, item.currency)}</td>
                      <td className="px-3 text-right">{item.unmatchedBills}</td>
                    </tr>)}
                  </tbody>
                </table>
                {report.byBranch.length === 0 ? <p className="p-5 text-sm text-slate-500">ไม่มีข้อมูลสาขาในช่วงเวลานี้</p> : null}
              </div>
            </section>
          ) : null}
          {tab === "methods" ? (
            <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <h3 className="border-b bg-slate-50 px-4 py-3 text-sm font-bold">รายงานรายการชำระตามช่องทาง</h3>
              <table className="w-full text-xs">
                <thead className="bg-[#eaf1fb] text-[#19385c]"><tr>
                  <th className="px-3 py-3 text-left">ช่องทาง</th><th className="px-3 py-3 text-center">สกุลเงิน</th>
                  <th className="px-3 py-3 text-right">จำนวนรายการ</th><th className="px-3 py-3 text-right">ยอดรับชำระ</th>
                </tr></thead><tbody>
                  {report.methods.map(item => <tr key={item.currency + item.method} className="border-b border-slate-100 even:bg-[#f7faff]">
                    <td className="px-3 py-3">{financePaymentMethodLabel(item.method)}</td><td className="px-3 text-center">{item.currency}</td>
                    <td className="px-3 text-right">{item.transactions}</td>
                    <td className="px-3 text-right tabular-nums">{value(item.received, item.currency)}</td>
                  </tr>)}
                </tbody>
              </table>
              {report.methods.length === 0 ? <p className="p-5 text-sm text-slate-500">ไม่มีการชำระเงินในช่วงเวลานี้</p> : null}
            </section>
          ) : null}

          <section className="rounded-lg border border-slate-200 bg-[#f7faff] px-4 py-3 text-xs text-slate-600">
            <p className="font-bold text-[#204a78]">หมายเหตุทางบัญชี</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {report.notes.map(note => <li key={note}>{note}</li>)}
              <li>ส่งออก CSV เฉพาะแถวที่แสดงในหน้าตารางปัจจุบัน ไม่ใช่รายงานทั้งช่วงวันที่หรือรายงานภาษี</li>
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
