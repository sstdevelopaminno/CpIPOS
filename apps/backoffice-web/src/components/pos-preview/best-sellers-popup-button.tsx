"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type BranchOption = { id: string; name: string; code: string | null };
type BestSellerItem = {
  rank: number;
  tier: "gold" | "silver" | "bronze" | "standard";
  product_id: string;
  sku: string | null;
  name: string;
  category: string | null;
  units: number;
  revenue: number;
  branches: string[];
};
type BestSellerResponse = {
  days: number;
  branch_id: string;
  branch_options: BranchOption[];
  items: BestSellerItem[];
  summary: { units: number; revenue: number };
};
type ApiEnvelope<T> = { data: T | null; error: { code: string; message: string } | null };
type Props = { th: boolean; branchId: string; branchOptions: BranchOption[]; canViewAllBranches: boolean };

const tierStyle: Record<BestSellerItem["tier"], string> = {
  gold: "border-amber-300 bg-amber-50 text-amber-900",
  silver: "border-slate-300 bg-slate-50 text-slate-800",
  bronze: "border-orange-300 bg-orange-50 text-orange-900",
  standard: "border-blue-100 bg-blue-50 text-blue-800"
};

function money(value: number) {
  return Number(value || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function units(value: number) {
  return Number(value || 0).toLocaleString("th-TH", { maximumFractionDigits: 3 });
}

export function BestSellersPopupButton({ th, branchId, branchOptions, canViewAllBranches }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState(canViewAllBranches ? "all" : branchId);
  const [days, setDays] = useState(30);
  const [payload, setPayload] = useState<BestSellerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");

  const options = useMemo(
    () => (branchOptions.length ? branchOptions : [{ id: branchId, name: branchId, code: null }]),
    [branchId, branchOptions]
  );

  useEffect(() => {
    if (!canViewAllBranches && selectedBranchId !== branchId) setSelectedBranchId(branchId);
  }, [branchId, canViewAllBranches, selectedBranchId]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorText("");
    try {
      const params = new URLSearchParams({ view: "best_sellers", branch_id: selectedBranchId, days: String(days) });
      const response = await fetch(`/api/backoffice/catalog?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<BestSellerResponse> | null;
      if (!response.ok || !body?.data || body.error) throw new Error(body?.error?.message ?? "Unable to load best sellers.");
      setPayload(body.data);
    } catch (error) {
      setPayload(null);
      setErrorText(error instanceof Error ? error.message : th ? "โหลดสินค้าขายดีไม่สำเร็จ" : "Failed to load best sellers.");
    } finally {
      setLoading(false);
    }
  }, [days, selectedBranchId, th]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const topThree = (payload?.items ?? []).slice(0, 3);
  const remaining = (payload?.items ?? []).slice(3);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
      >
        {th ? "สินค้าขายดี" : "Best Sellers"}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[136] grid place-items-center bg-slate-900/55 p-4" onClick={() => setOpen(false)}>
          <section
            onClick={(event) => event.stopPropagation()}
            className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <header className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eef5ff_58%,#fff7ed_100%)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black text-slate-900">{th ? "สินค้าขายดี" : "Best Sellers"}</h3>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    {th ? "จัดอันดับสินค้าที่ขายดีที่สุดจากรายการขายที่ปิดบิลแล้ว" : "Rank products from completed sales."}
                  </p>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700">
                  {th ? "ปิด" : "Close"}
                </button>
              </div>

              <div className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-white/85 p-3 md:grid-cols-[minmax(0,1fr)_170px_auto] md:items-end">
                <label className="grid gap-1 text-xs font-bold text-slate-600">
                  <span>{th ? "สาขา" : "Branch"}</span>
                  <select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900">
                    {canViewAllBranches ? <option value="all">{th ? "ทุกสาขา" : "All branches"}</option> : null}
                    {options.map((branch) => (
                      <option key={branch.id} value={branch.id}>{branch.name || branch.code || branch.id}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-bold text-slate-600">
                  <span>{th ? "ช่วงเวลา" : "Period"}</span>
                  <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900">
                    <option value={1}>{th ? "วันนี้" : "Today"}</option>
                    <option value={7}>{th ? "7 วัน" : "7 days"}</option>
                    <option value={30}>{th ? "30 วัน" : "30 days"}</option>
                    <option value={90}>{th ? "90 วัน" : "90 days"}</option>
                  </select>
                </label>
                <button type="button" onClick={() => void load()} disabled={loading} className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-60">
                  {loading ? "..." : th ? "รีเฟรช" : "Refresh"}
                </button>
              </div>
            </header>

            <div className="max-h-[64vh] overflow-y-auto p-4">
              {errorText ? <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{errorText}</p> : null}
              <div className="grid gap-3 md:grid-cols-3">
                <Summary label={th ? "ยอดขายรวม" : "Revenue"} value={`฿${money(payload?.summary.revenue ?? 0)}`} />
                <Summary label={th ? "จำนวนขายรวม" : "Units"} value={units(payload?.summary.units ?? 0)} />
                <Summary label={th ? "จำนวนสินค้าในอันดับ" : "Ranked Products"} value={String(payload?.items.length ?? 0)} />
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {topThree.map((item) => (
                  <article key={item.product_id} className={`rounded-xl border p-4 ${tierStyle[item.tier]}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black">{th ? `ระดับ ${item.rank}` : `Rank ${item.rank}`}</p>
                        <h4 className="mt-2 text-base font-black text-slate-950">{item.name}</h4>
                        <p className="mt-1 text-xs font-semibold opacity-75">{item.category ?? "-"}</p>
                      </div>
                      <span className="grid h-10 w-10 place-items-center rounded-full border border-current bg-white/70 text-lg font-black">{item.rank}</span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                      <div><p className="text-xs opacity-70">{th ? "จำนวนขาย" : "Units"}</p><p className="font-black">{units(item.units)}</p></div>
                      <div><p className="text-xs opacity-70">{th ? "ยอดขาย" : "Revenue"}</p><p className="font-black">฿{money(item.revenue)}</p></div>
                    </div>
                  </article>
                ))}
              </div>

              {!loading && (payload?.items.length ?? 0) === 0 ? (
                <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">{th ? "ยังไม่มีข้อมูลการขายในช่วงเวลานี้" : "No completed sales in this period."}</p>
              ) : null}

              {remaining.length ? (
                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-[760px] w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500"><tr><th className="px-3 py-3">{th ? "อันดับ" : "Rank"}</th><th className="px-3 py-3">{th ? "สินค้า" : "Product"}</th><th className="px-3 py-3">{th ? "หมวดหมู่" : "Category"}</th><th className="px-3 py-3 text-right">{th ? "จำนวนขาย" : "Units"}</th><th className="px-3 py-3 text-right">{th ? "ยอดขาย" : "Revenue"}</th><th className="px-3 py-3">{th ? "สาขา" : "Branches"}</th></tr></thead>
                    <tbody>{remaining.map((item) => <tr key={item.product_id} className="border-t border-slate-100"><td className="px-3 py-3 font-black">#{item.rank}</td><td className="px-3 py-3"><p className="font-bold">{item.name}</p><p className="text-xs text-slate-500">{item.sku ?? "-"}</p></td><td className="px-3 py-3">{item.category ?? "-"}</td><td className="px-3 py-3 text-right font-bold">{units(item.units)}</td><td className="px-3 py-3 text-right font-bold">฿{money(item.revenue)}</td><td className="px-3 py-3">{item.branches.join(", ") || "-"}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-slate-900">{value}</p></article>;
}
