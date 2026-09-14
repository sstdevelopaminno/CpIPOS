"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";

type RangeMode = "today" | "custom" | "month" | "year";
type BranchOption = { id: string; code: string; name: string };
type ProductSaleRow = {
  id: string;
  order_id: string;
  bill_no: string;
  sold_at: string;
  branch_id: string;
  branch_name: string;
  product_id: string;
  sku: string | null;
  product_name: string;
  category: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
  order_status: string;
  best_seller_rank: number | null;
  best_seller_status: "top_1" | "top_2" | "top_3" | "best_seller" | "normal" | "cancelled";
};
type ProductSalesPayload = {
  from: string;
  to: string;
  branch_id: string;
  branch_options: BranchOption[];
  rows: ProductSaleRow[];
  summary: { line_count: number; units: number; revenue: number };
};
type ApiEnvelope<T> = { data: T | null; error: { code?: string; message?: string } | null };

type Props = { lang: Language; canViewAllBranches: boolean; initialBranchId: string };

function bangkokToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function monthLastDay(month: string) {
  const [year, monthNo] = month.split("-").map(Number);
  if (!year || !monthNo) return `${month}-28`;
  return `${month}-${String(new Date(Date.UTC(year, monthNo, 0)).getUTCDate()).padStart(2, "0")}`;
}

function formatMoney(value: number, lang: Language) {
  return Number(value || 0).toLocaleString(lang === "th" ? "th-TH" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function bestSellerLabel(row: ProductSaleRow, th: boolean) {
  if (row.best_seller_status === "cancelled") return th ? "ยกเลิก" : "Cancelled";
  if (row.best_seller_status === "top_1") return th ? "ขายดีอันดับ 1" : "Best seller #1";
  if (row.best_seller_status === "top_2") return th ? "ขายดีอันดับ 2" : "Best seller #2";
  if (row.best_seller_status === "top_3") return th ? "ขายดีอันดับ 3" : "Best seller #3";
  if (row.best_seller_status === "best_seller") return th ? "ขายดี" : "Best seller";
  return th ? "ปกติ" : "Normal";
}

export function ProductSalesWorkspace({ lang, canViewAllBranches, initialBranchId }: Props) {
  const th = lang === "th";
  const today = useMemo(() => bangkokToday(), []);
  const [mode, setMode] = useState<RangeMode>("today");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [year, setYear] = useState(today.slice(0, 4));
  const [branchId, setBranchId] = useState(canViewAllBranches ? "all" : initialBranchId);
  const [payload, setPayload] = useState<ProductSalesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [search, setSearch] = useState("");

  const resolveRange = useCallback(() => {
    if (mode === "today") return { from: today, to: today };
    if (mode === "month") return { from: `${month}-01`, to: monthLastDay(month) };
    if (mode === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
    return { from: fromDate, to: toDate };
  }, [fromDate, mode, month, toDate, today, year]);

  const load = useCallback(async () => {
    const range = resolveRange();
    if (!range.from || !range.to) return;
    setLoading(true);
    setErrorText("");
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to, branch_id: branchId });
      const response = await fetch(`/api/pos/product-sales?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<ProductSalesPayload> | null;
      if (!response.ok || !body?.data || body.error) throw new Error(body?.error?.message ?? (th ? "โหลดรายการขายสินค้าไม่สำเร็จ" : "Unable to load product sales."));
      setPayload(body.data);
    } catch (error) {
      setPayload(null);
      setErrorText(error instanceof Error ? error.message : th ? "โหลดรายการขายสินค้าไม่สำเร็จ" : "Unable to load product sales.");
    } finally {
      setLoading(false);
    }
  }, [branchId, resolveRange, th]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payload?.rows ?? [];
    return (payload?.rows ?? []).filter((row) =>
      [row.bill_no, row.product_name, row.sku ?? "", row.category ?? "", row.branch_name].some((value) => value.toLowerCase().includes(q))
    );
  }, [payload?.rows, search]);

  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(th ? "th-TH" : "en-US", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }),
    [th]
  );

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-slate-50 p-3 sm:p-5">
      <section className="min-h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-950">{th ? "รายการขายสินค้า" : "Product Sales"}</h1>
            <p className="mt-1 text-sm font-medium text-slate-500">{th ? "ตรวจสอบสินค้าที่ขายจริง ราคา จำนวน สาขา และสถานะสินค้าขายดี" : "Review sold products, price, quantity, branch and best-seller status."}</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-60">
            {loading ? (th ? "กำลังโหลด..." : "Loading...") : th ? "รีเฟรช" : "Refresh"}
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap gap-2">
            {(["today", "custom", "month", "year"] as RangeMode[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={`h-9 rounded-lg border px-3 text-sm font-bold ${mode === value ? "border-orange-500 bg-orange-500 text-white" : "border-slate-300 bg-white text-slate-700"}`}
              >
                {value === "today" ? (th ? "วันนี้" : "Today") : value === "custom" ? (th ? "วันที่ ถึง วันที่" : "Date range") : value === "month" ? (th ? "รายเดือน" : "Monthly") : th ? "รายปี" : "Yearly"}
              </button>
            ))}
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {mode === "custom" ? (
              <>
                <label className="grid gap-1 text-xs font-bold text-slate-600">{th ? "จากวันที่" : "From"}<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm" /></label>
                <label className="grid gap-1 text-xs font-bold text-slate-600">{th ? "ถึงวันที่" : "To"}<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm" /></label>
              </>
            ) : null}
            {mode === "month" ? <label className="grid gap-1 text-xs font-bold text-slate-600">{th ? "เดือน" : "Month"}<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm" /></label> : null}
            {mode === "year" ? <label className="grid gap-1 text-xs font-bold text-slate-600">{th ? "ปี" : "Year"}<input type="number" min={2020} max={2100} value={year} onChange={(event) => setYear(event.target.value.slice(0, 4))} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm" /></label> : null}
            <label className="grid gap-1 text-xs font-bold text-slate-600">{th ? "สาขา" : "Branch"}
              <select value={branchId} onChange={(event) => setBranchId(event.target.value)} disabled={!canViewAllBranches} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold disabled:bg-slate-100">
                {canViewAllBranches ? <option value="all">{th ? "ทุกสาขา" : "All branches"}</option> : null}
                {(payload?.branch_options ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-xs font-bold text-slate-600">{th ? "ค้นหา" : "Search"}<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={th ? "บิล / สินค้า / SKU / สาขา" : "Bill / product / SKU / branch"} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm" /></label>
            <div className="flex items-end"><button type="button" onClick={() => void load()} className="h-10 rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-bold text-white">{th ? "ใช้ตัวกรอง" : "Apply"}</button></div>
          </div>
        </div>

        {errorText ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{errorText}</p> : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Summary label={th ? "จำนวนรายการ" : "Lines"} value={String(payload?.summary.line_count ?? 0)} />
          <Summary label={th ? "จำนวนขายรวม" : "Units sold"} value={Number(payload?.summary.units ?? 0).toLocaleString(th ? "th-TH" : "en-US", { maximumFractionDigits: 3 })} />
          <Summary label={th ? "ยอดขายรวม" : "Revenue"} value={`฿${formatMoney(payload?.summary.revenue ?? 0, lang)}`} />
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[1100px] w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs font-bold text-slate-600">
              <tr><th className="px-3 py-3">{th ? "วันที่ขาย" : "Sold at"}</th><th className="px-3 py-3">{th ? "เลขบิล" : "Bill"}</th><th className="px-3 py-3">{th ? "สินค้า" : "Product"}</th><th className="px-3 py-3 text-right">{th ? "ราคา" : "Price"}</th><th className="px-3 py-3 text-right">{th ? "จำนวนขาย" : "Qty"}</th><th className="px-3 py-3 text-right">{th ? "ยอดรวม" : "Total"}</th><th className="px-3 py-3">{th ? "สาขา" : "Branch"}</th><th className="px-3 py-3">{th ? "สถานะบิล" : "Bill status"}</th><th className="px-3 py-3">{th ? "สถานะ" : "Status"}</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {!filteredRows.length ? <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-500">{loading ? (th ? "กำลังโหลด..." : "Loading...") : th ? "ไม่พบรายการขายสินค้าในช่วงเวลานี้" : "No product sales in this period."}</td></tr> : filteredRows.map((row) => (
                <tr key={row.id} className={row.order_status === "cancelled" ? "bg-red-50/30" : "hover:bg-slate-50"}>
                  <td className="px-3 py-3 text-slate-700">{dateTime.format(new Date(row.sold_at))}</td>
                  <td className="px-3 py-3 font-bold text-slate-900">{row.bill_no}</td>
                  <td className="px-3 py-3"><p className="font-bold text-slate-900">{row.product_name}</p><p className="text-xs text-slate-500">{row.sku ?? "-"} · {row.category ?? "-"}</p></td>
                  <td className="px-3 py-3 text-right">฿{formatMoney(row.unit_price, lang)}</td>
                  <td className="px-3 py-3 text-right font-bold">{row.quantity.toLocaleString(th ? "th-TH" : "en-US", { maximumFractionDigits: 3 })}</td>
                  <td className="px-3 py-3 text-right font-bold">฿{formatMoney(row.line_total, lang)}</td>
                  <td className="px-3 py-3">{row.branch_name}</td>
                  <td className="px-3 py-3"><Badge tone={row.order_status === "cancelled" ? "red" : "green"}>{row.order_status === "cancelled" ? (th ? "ยกเลิก" : "Cancelled") : (th ? "ขายสำเร็จ" : "Completed")}</Badge></td>
                  <td className="px-3 py-3"><Badge tone={row.best_seller_status.startsWith("top_") || row.best_seller_status === "best_seller" ? "orange" : row.best_seller_status === "cancelled" ? "red" : "slate"}>{bestSellerLabel(row, th)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-slate-900">{value}</p></article>;
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "green" | "red" | "orange" | "slate" }) {
  const style = tone === "green" ? "border-green-200 bg-green-50 text-green-700" : tone === "red" ? "border-red-200 bg-red-50 text-red-700" : tone === "orange" ? "border-orange-200 bg-orange-50 text-orange-700" : "border-slate-200 bg-slate-50 text-slate-700";
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${style}`}>{children}</span>;
}
