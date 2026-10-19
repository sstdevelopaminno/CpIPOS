"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";
import { formatSalesMoney } from "@/lib/pos-money";
import type { PosSalesBranchOption, PosSalesListRecord } from "@/lib/services/pos-sales-list-service";

type History = { records: PosSalesListRecord[]; branches: PosSalesBranchOption[] };
type Envelope = { data?: History | null; error?: { message?: string } | null };

export function PosOpticalBasicSalesHistory({ lang, initialRecords, initialBranches }: {
  lang: Language; initialRecords: PosSalesListRecord[]; initialBranches: PosSalesBranchOption[]
}) {
  const [history, setHistory] = useState<History>({ records: initialRecords, branches: initialBranches });
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locale = lang === "lo" ? "lo-LA" : lang === "en" ? "en-US" : "th-TH";
  const th = lang !== "en";
  const formatDate = useMemo(() => new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short"
  }), [locale]);
  const branches = useMemo(() => new Map(history.branches.map(item => [item.id, item.name])), [history.branches]);
  const rows = useMemo(() => history.records.filter(item =>
    (branch === "all" || item.branchId === branch) &&
    (!query || [item.billNo, item.customerName, item.cashier].some(v => v.toLowerCase().includes(query.toLowerCase())))
  ).slice(0, 500), [history.records, query, branch]);
  const refresh = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/pos/optical/sales-history", { credentials: "include", cache: "no-store" });
      const body = await response.json() as Envelope;
      if (!response.ok || !body.data) throw new Error(body.error?.message || "Unable to refresh sales history");
      setHistory(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh sales history");
    } finally { setBusy(false); }
  }, []);
  useEffect(() => { const listener = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  }, [refresh]);
  return <main className="h-full min-h-0 overflow-y-auto bg-slate-50 p-4">
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-bold text-slate-950">{th ? "รายการขายร้านแว่นตา" : "Optical sales history"}</h1>
          <p className="text-sm text-slate-500">{th ? "ประวัติรายการขายพื้นฐาน • อ่านอย่างเดียว ไม่สามารถแก้ไขหรือลบบิล" : "Basic bill history • read only"}</p></div>
        <button type="button" onClick={() => void refresh()} disabled={busy}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? "..." : th ? "รีเฟรช" : "Refresh"}</button>
      </div>
      {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <div className="my-4 flex flex-wrap items-center gap-2">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder={th ? "ค้นหาเลขบิล / ลูกค้า / พนักงาน" : "Search bills, customers, cashiers"}
          className="min-w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        {history.branches.length > 1 ? <select value={branch} onChange={event => setBranch(event.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
          <option value="all">{th ? "ทุกสาขาที่มีสิทธิ์" : "Accessible branches"}</option>
          {history.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select> : null}
        <span className="text-sm text-slate-500">{th ? "จำนวนบิล" : "Bills"}: {rows.length}</span>
      </div>
      <div className="overflow-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-slate-100 text-slate-700"><tr>
            <th className="p-3">{th ? "เลขบิล" : "Bill"}</th><th className="p-3">{th ? "วันที่" : "Date"}</th>
            <th className="p-3">{th ? "สาขา" : "Branch"}</th><th className="p-3">{th ? "ลูกค้า" : "Customer"}</th>
            <th className="p-3">{th ? "สถานะ" : "Status"}</th><th className="p-3 text-right">{th ? "ยอดรวม" : "Total"}</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? <tr><td colSpan={6} className="p-8 text-center text-slate-500">{th ? "ยังไม่มีรายการขาย" : "No sales"}</td></tr> :
              rows.map(item => <tr key={item.id}>
                <td className="p-3 font-semibold">{item.billNo}</td>
                <td className="p-3">{formatDate.format(new Date(item.openedAt))}</td>
                <td className="p-3">{branches.get(item.branchId) ?? "-"}</td>
                <td className="p-3">{item.customerName || "-"}</td>
                <td className="p-3">{item.saleStatus === "paid" ? (th ? "ชำระแล้ว" : "Paid") : item.saleStatus === "void" ? (th ? "ยกเลิก" : "Void") : (th ? "เปิดบิล" : "Open")}</td>
                <td className="p-3 text-right font-semibold">{formatSalesMoney(item.total, item.currencyCode, locale)}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
