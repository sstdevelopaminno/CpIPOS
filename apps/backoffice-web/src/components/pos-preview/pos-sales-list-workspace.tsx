"use client";

import type { ApprovalAction, BranchRole, PlatformRole } from "@pos/shared-types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PosManagerApprovalModal } from "@/components/pos-ui/pos-manager-approval-modal";
import { downloadExcelCsv } from "@/lib/excel-csv";
import type { Language } from "@/lib/i18n";
import type { PosSalesBranchOption, PosSalesListRecord, PosSalesShiftOption } from "@/lib/services/pos-sales-list-service";

type SaleStatus = "open" | "paid" | "void";
type PaymentStatus = "unpaid" | "cash" | "bank_transfer";
type QuickRange = "day" | "month" | "year" | "custom" | "all";
type EffectiveRole = BranchRole | "it_admin";

type Props = {
  lang: Language;
  initialRole: BranchRole | null;
  platformRole: PlatformRole;
  initialBranchId: string | null;
  initialRecords: PosSalesListRecord[];
  branchOptions: PosSalesBranchOption[];
  shiftOptions: PosSalesShiftOption[];
  refreshEndpoint?: string;
};

type PinAction = { type: "edit" | "delete"; row: PosSalesListRecord; approvalAction: ApprovalAction };
type EditTarget = { row: PosSalesListRecord; approvalId: string | null };
type BillLineItem = {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  category: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes: string | null;
};
type BillItemsPayload = {
  order: { id: string; bill_no: string; branch_id: string; status: string; total: number; created_at: string };
  items: BillLineItem[];
};
type ApiEnvelope<T> = { data: T | null; error: { code?: string; message?: string } | null };

const PAGE_SIZE = 20;
const REFRESH_INTERVAL_MS = 15000;

function bangkokDate(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function bangkokToday() {
  return bangkokDate(new Date());
}

function money(value: number, lang: Language) {
  return Number(value || 0).toLocaleString(lang === "th" ? "th-TH" : "en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatQuantity(value: number, lang: Language) {
  return Number(value || 0).toLocaleString(lang === "th" ? "th-TH" : "en-US", { maximumFractionDigits: 3 });
}

export function PosSalesListWorkspace({
  lang,
  initialRole,
  platformRole,
  initialBranchId,
  initialRecords,
  branchOptions,
  shiftOptions,
  refreshEndpoint = "/api/pos/sales-list"
}: Props) {
  const th = lang === "th";
  const [records, setRecords] = useState(initialRecords);
  const [liveBranchOptions, setLiveBranchOptions] = useState(branchOptions);
  const [liveShiftOptions, setLiveShiftOptions] = useState(shiftOptions);
  const [selectedBranchId, setSelectedBranchId] = useState("all");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SaleStatus>("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | PaymentStatus>("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [quickRange, setQuickRange] = useState<QuickRange>("day");
  const today = useMemo(() => bangkokToday(), []);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [filterPopupOpen, setFilterPopupOpen] = useState(false);
  const [selectedDetailRow, setSelectedDetailRow] = useState<PosSalesListRecord | null>(null);
  const [billItems, setBillItems] = useState<BillItemsPayload | null>(null);
  const [billItemsOpen, setBillItemsOpen] = useState(false);
  const [billItemsLoading, setBillItemsLoading] = useState(false);
  const [billItemsError, setBillItemsError] = useState("");
  const [pinAction, setPinAction] = useState<PinAction | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editSaleStatus, setEditSaleStatus] = useState<SaleStatus>("open");
  const [editPaymentStatus, setEditPaymentStatus] = useState<PaymentStatus>("unpaid");
  const [editNotes, setEditNotes] = useState("");
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const [notice, setNotice] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const effectiveRole: EffectiveRole = platformRole === "it_admin" ? "it_admin" : (initialRole ?? "staff");
  const canManage = effectiveRole === "owner" || effectiveRole === "manager" || effectiveRole === "it_admin";
  const requiresPin = effectiveRole === "owner" || effectiveRole === "manager";
  const canViewAllBranches = effectiveRole === "owner" || effectiveRole === "manager" || effectiveRole === "accountant" || effectiveRole === "it_admin";
  const normalizedBranchId = initialBranchId && liveBranchOptions.some((branch) => branch.id === initialBranchId) ? initialBranchId : (liveBranchOptions[0]?.id ?? "");
  const effectiveBranchId = canViewAllBranches ? selectedBranchId : normalizedBranchId;
  const branchMap = useMemo(() => new Map(liveBranchOptions.map((branch) => [branch.id, branch])), [liveBranchOptions]);
  const pauseRefresh = Boolean(selectedDetailRow || billItemsOpen || pinAction || editTarget || filterPopupOpen);

  const loadLatest = useCallback(async () => {
    const response = await fetch(refreshEndpoint, { cache: "no-store" });
    const body = (await response.json().catch(() => null)) as ApiEnvelope<{
      records?: PosSalesListRecord[];
      branchOptions?: PosSalesBranchOption[];
      shiftOptions?: PosSalesShiftOption[];
    }> | null;
    if (!response.ok || !body?.data) return;
    setRecords(body.data.records ?? []);
    setLiveBranchOptions(body.data.branchOptions ?? []);
    setLiveShiftOptions(body.data.shiftOptions ?? []);
  }, [refreshEndpoint]);

  useEffect(() => setRecords(initialRecords), [initialRecords]);
  useEffect(() => setLiveBranchOptions(branchOptions), [branchOptions]);
  useEffect(() => setLiveShiftOptions(shiftOptions), [shiftOptions]);

  useEffect(() => {
    if (!canViewAllBranches) setSelectedBranchId(normalizedBranchId);
  }, [canViewAllBranches, normalizedBranchId]);

  useEffect(() => {
    if (!selectedDetailRow) return;
    const latest = records.find((row) => row.id === selectedDetailRow.id);
    if (latest) setSelectedDetailRow(latest);
  }, [records, selectedDetailRow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let mounted = true;
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (!mounted || inFlight || document.hidden || pauseRefresh) return;
      inFlight = true;
      try { await loadLatest(); } catch { /* keep the last successful table */ } finally { inFlight = false; }
    }, REFRESH_INTERVAL_MS);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [loadLatest, pauseRefresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const monthPrefix = today.slice(0, 7);
    const yearPrefix = today.slice(0, 4);
    return records.filter((row) => {
      const rowDate = bangkokDate(row.openedAt);
      const branchMatch = effectiveBranchId === "all" || row.branchId === effectiveBranchId;
      const queryMatch = !normalized || [row.billNo, row.tableLabel, row.customerName, row.cashier].some((value) => String(value ?? "").toLowerCase().includes(normalized));
      const statusMatch = statusFilter === "all" || row.saleStatus === statusFilter;
      const paymentMatch = paymentFilter === "all" || row.paymentStatus === paymentFilter;
      const shiftMatch = shiftFilter === "all" || row.shiftId === shiftFilter;
      const dateMatch = quickRange === "all"
        ? true
        : quickRange === "day"
          ? rowDate === today
          : quickRange === "month"
            ? rowDate.startsWith(monthPrefix)
            : quickRange === "year"
              ? rowDate.startsWith(yearPrefix)
              : (!fromDate || rowDate >= fromDate) && (!toDate || rowDate <= toDate);
      return branchMatch && queryMatch && statusMatch && paymentMatch && shiftMatch && dateMatch;
    });
  }, [effectiveBranchId, fromDate, paymentFilter, query, quickRange, records, shiftFilter, statusFilter, toDate, today]);

  const sortedRows = useMemo(() => [...filteredRows].sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()), [filteredRows]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedRows = useMemo(() => sortedRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [safePage, sortedRows]);
  const metrics = useMemo(() => ({
    bills: filteredRows.length,
    paid: filteredRows.filter((row) => row.saleStatus === "paid").length,
    voided: filteredRows.filter((row) => row.saleStatus === "void").length,
    total: filteredRows.filter((row) => row.saleStatus !== "void").reduce((sum, row) => sum + Number(row.total || 0), 0)
  }), [filteredRows]);

  useEffect(() => setCurrentPage(1), [effectiveBranchId, fromDate, paymentFilter, query, quickRange, shiftFilter, statusFilter, toDate]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);

  const dateTimeFormatter = useMemo(() => new Intl.DateTimeFormat(th ? "th-TH" : "en-US", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }), [th]);

  function saleStatusLabel(value: PosSalesListRecord["saleStatus"] | SaleStatus) {
    if (value === "paid") return th ? "ชำระแล้ว" : "Paid";
    if (value === "void") return th ? "ยกเลิก" : "Cancelled";
    return th ? "เปิดบิล" : "Open";
  }

  function paymentLabel(value: string) {
    if (value === "cash") return th ? "เงินสด" : "Cash";
    if (value === "bank_transfer") return th ? "โอนเงิน" : "Bank transfer";
    return th ? "ยังไม่ชำระ" : "Unpaid";
  }

  function channelLabel(value: string) {
    if (value === "dine_in") return th ? "นั่งโต๊ะ" : "Dine in";
    if (value === "delivery") return th ? "เดลิเวอรี" : "Delivery";
    return th ? "เคาน์เตอร์" : "Counter";
  }

  function exportCsv() {
    const rows: Array<Array<string | number>> = [
      [th ? "เลขบิล" : "Bill", th ? "วันที่" : "Date", th ? "ช่องทาง" : "Channel", th ? "จำนวนรายการ" : "Items", th ? "ยอดรวม" : "Total", th ? "การชำระ" : "Payment", th ? "สถานะ" : "Status", th ? "ผู้ทำรายการ" : "Cashier"],
      ...sortedRows.map((row) => [row.billNo, dateTimeFormatter.format(new Date(row.openedAt)), channelLabel(row.channel), row.items, row.total, paymentLabel(row.paymentStatus), saleStatusLabel(row.saleStatus), row.cashier])
    ];
    downloadExcelCsv(`cpipos-sales-${today}.csv`, rows);
  }

  function requestAction(action: PinAction) {
    setMutationError("");
    if (requiresPin) setPinAction(action);
    else void runAuthorizedAction(action, null);
  }

  async function runAuthorizedAction(action: PinAction, approvalId: string | null) {
    if (action.type === "edit") {
      setEditTarget({ row: action.row, approvalId });
      setEditSaleStatus(action.row.saleStatus);
      setEditPaymentStatus(action.row.paymentStatus as PaymentStatus);
      setEditNotes(action.row.notes ?? "");
      return;
    }

    setMutationBusy(true);
    setMutationError("");
    try {
      const response = await fetch(refreshEndpoint, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: action.row.id, approval_id: approvalId })
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ deleted?: boolean }> | null;
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? (th ? "ยกเลิกบิลไม่สำเร็จ" : "Unable to cancel bill."));
      setSelectedDetailRow(null);
      setBillItemsOpen(false);
      await loadLatest();
      setNotice(th ? "ยกเลิกบิลและคืนสต๊อกสินค้าเรียบร้อยแล้ว" : "Bill cancelled and stock restored.");
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : th ? "ทำรายการไม่สำเร็จ" : "Action failed.");
    } finally {
      setMutationBusy(false);
    }
  }

  async function saveEdit() {
    if (!editTarget) return;
    setMutationBusy(true);
    setMutationError("");
    try {
      const response = await fetch(refreshEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: editTarget.row.id,
          approval_id: editTarget.approvalId,
          sale_status: editSaleStatus,
          payment_status: editSaleStatus === "void" ? "unpaid" : editPaymentStatus,
          notes: editNotes
        })
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ updated?: boolean }> | null;
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? (th ? "บันทึกไม่สำเร็จ" : "Unable to save changes."));
      setEditTarget(null);
      await loadLatest();
      setNotice(editSaleStatus === "void" ? (th ? "ยกเลิกบิลและคืนสต๊อกสินค้าเรียบร้อยแล้ว" : "Bill cancelled and stock restored.") : (th ? "บันทึกรายการขายแล้ว" : "Sales record updated."));
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : th ? "บันทึกไม่สำเร็จ" : "Unable to save changes.");
    } finally {
      setMutationBusy(false);
    }
  }

  async function openBillItems(row: PosSalesListRecord) {
    setBillItemsOpen(true);
    setBillItems(null);
    setBillItemsError("");
    setBillItemsLoading(true);
    try {
      const response = await fetch(`/api/pos/sales-list/order-items?order_id=${encodeURIComponent(row.id)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<BillItemsPayload> | null;
      if (!response.ok || !body?.data || body.error) throw new Error(body?.error?.message ?? (th ? "โหลดสินค้าในบิลไม่สำเร็จ" : "Unable to load bill items."));
      setBillItems(body.data);
    } catch (error) {
      setBillItemsError(error instanceof Error ? error.message : th ? "โหลดสินค้าในบิลไม่สำเร็จ" : "Unable to load bill items.");
    } finally {
      setBillItemsLoading(false);
    }
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-slate-50 p-3 sm:p-4">
      <section className="min-h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-[linear-gradient(90deg,#f8fafc,#fff7ed)] p-4">
          <h1 className="text-2xl font-black text-slate-950">{th ? "รายการขาย" : "Sales List"}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={th ? "ค้นหาเลขบิล / โต๊ะ / ลูกค้า" : "Search bill / table / customer"} className="h-10 min-w-[210px] rounded-lg border border-slate-300 bg-white px-3 text-sm" />
            <button type="button" onClick={() => setQuickRange("day")} className={`h-10 rounded-lg border px-3 text-sm font-bold ${quickRange === "day" ? "border-orange-500 bg-orange-500 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{th ? "วันนี้" : "Today"}</button>
            <button type="button" onClick={() => setQuickRange("month")} className={`h-10 rounded-lg border px-3 text-sm font-bold ${quickRange === "month" ? "border-orange-500 bg-orange-500 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{th ? "รายเดือน" : "Monthly"}</button>
            <button type="button" onClick={() => setQuickRange("year")} className={`h-10 rounded-lg border px-3 text-sm font-bold ${quickRange === "year" ? "border-orange-500 bg-orange-500 text-white" : "border-slate-300 bg-white text-slate-700"}`}>{th ? "รายปี" : "Yearly"}</button>
            <button type="button" onClick={() => setFilterPopupOpen(true)} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700">{th ? "คัดกรอง" : "Filter"}</button>
            <button type="button" onClick={exportCsv} disabled={!sortedRows.length} className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 disabled:opacity-40">Export CSV</button>
            <select value={canViewAllBranches ? selectedBranchId : normalizedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)} disabled={!canViewAllBranches} className="h-10 min-w-[170px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold disabled:bg-slate-100">
              {canViewAllBranches ? <option value="all">{th ? "ทุกสาขา" : "All branches"}</option> : null}
              {liveBranchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code || branch.id})</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label={th ? "จำนวนบิล" : "Bills"} value={String(metrics.bills)} />
          <Metric label={th ? "ชำระแล้ว" : "Paid"} value={String(metrics.paid)} />
          <Metric label={th ? "ยกเลิก" : "Cancelled"} value={String(metrics.voided)} />
          <Metric label={th ? "ยอดขายสุทธิ" : "Net sales"} value={`฿${money(metrics.total, lang)}`} />
        </div>

        {notice || mutationError ? <div className={`mt-3 rounded-xl border px-3 py-2 text-sm font-semibold ${mutationError ? "border-red-200 bg-red-50 text-red-700" : "border-green-200 bg-green-50 text-green-700"}`}>{mutationError || notice}</div> : null}

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
          <div className="max-h-[calc(100vh-330px)] min-h-[300px] overflow-auto">
            <table className="min-w-[1200px] w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 text-left text-xs font-bold text-slate-600">
                <tr><th className="px-3 py-3">{th ? "เลขบิล" : "Bill"}</th><th className="px-3 py-3">{th ? "เวลาเปิดบิล" : "Opened"}</th><th className="px-3 py-3">{th ? "โต๊ะ/ช่องทาง" : "Table/channel"}</th><th className="px-3 py-3">{th ? "จำนวนรายการ" : "Items"}</th><th className="px-3 py-3">{th ? "สาขา" : "Branch"}</th><th className="px-3 py-3 text-right">{th ? "ยอดรวม" : "Total"}</th><th className="px-3 py-3">{th ? "ชำระเงิน" : "Payment"}</th><th className="px-3 py-3">{th ? "สถานะบิล" : "Status"}</th><th className="px-3 py-3">{th ? "ผู้ทำรายการ" : "Cashier"}</th><th className="px-3 py-3 text-right">{th ? "จัดการ" : "Actions"}</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {!pagedRows.length ? <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-500">{th ? "ไม่พบข้อมูลตามเงื่อนไขที่เลือก" : "No records match the selected filters."}</td></tr> : pagedRows.map((row) => {
                  const branch = branchMap.get(row.branchId);
                  return (
                    <tr key={row.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelectedDetailRow(row)}>
                      <td className="px-3 py-3 font-bold text-slate-900">{row.billNo}</td>
                      <td className="px-3 py-3 text-slate-700">{dateTimeFormatter.format(new Date(row.openedAt))}</td>
                      <td className="px-3 py-3"><p>{row.tableLabel}</p><p className="text-xs text-slate-500">{channelLabel(row.channel)}</p></td>
                      <td className="px-3 py-3">{row.items}</td>
                      <td className="px-3 py-3"><p>{branch?.name ?? "-"}</p><p className="text-xs text-slate-500">{branch?.code ?? "-"}</p></td>
                      <td className="px-3 py-3 text-right font-bold">฿{money(row.total, lang)}</td>
                      <td className="px-3 py-3"><Badge tone={row.paymentStatus === "unpaid" ? "slate" : "green"}>{paymentLabel(row.paymentStatus)}</Badge></td>
                      <td className="px-3 py-3"><Badge tone={row.saleStatus === "void" ? "red" : row.saleStatus === "paid" ? "blue" : "orange"}>{saleStatusLabel(row.saleStatus)}</Badge></td>
                      <td className="px-3 py-3">{row.cashier || "-"}</td>
                      <td className="px-3 py-3"><div className="flex justify-end gap-1"><button type="button" disabled={!canManage || mutationBusy} onClick={(event) => { event.stopPropagation(); requestAction({ type: "edit", row, approvalAction: "sales_record_edit" }); }} className="h-8 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-bold text-blue-700 disabled:opacity-40">{th ? "แก้ไข" : "Edit"}</button><button type="button" disabled={!canManage || mutationBusy || row.saleStatus === "void"} onClick={(event) => { event.stopPropagation(); requestAction({ type: "delete", row, approvalAction: "sales_record_delete" }); }} className="h-8 rounded-md border border-red-200 bg-red-50 px-2 text-xs font-bold text-red-700 disabled:opacity-40">{th ? "ยกเลิก" : "Cancel"}</button></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {sortedRows.length ? <div className="flex items-center justify-between border-t border-slate-200 bg-white px-3 py-3 text-xs text-slate-500"><span>{th ? `ทั้งหมด ${sortedRows.length} บิล` : `${sortedRows.length} bills`}</span><div className="flex items-center gap-2"><button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={safePage <= 1} className="h-8 rounded-md border border-slate-300 px-3 disabled:opacity-40">{th ? "ก่อนหน้า" : "Prev"}</button><span>{safePage}/{totalPages}</span><button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={safePage >= totalPages} className="h-8 rounded-md border border-slate-300 px-3 disabled:opacity-40">{th ? "ถัดไป" : "Next"}</button></div></div> : null}
        </div>
      </section>

      {filterPopupOpen ? (
        <ModalLayer z="z-50" onBackdrop={() => setFilterPopupOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between"><h3 className="text-lg font-black">{th ? "คัดกรองรายการขาย" : "Sales filters"}</h3><button type="button" onClick={() => setFilterPopupOpen(false)} className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-bold">{th ? "ปิด" : "Close"}</button></div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <Field label={th ? "สถานะบิล" : "Bill status"}><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | SaleStatus)} className="h-10 w-full rounded-lg border border-slate-300 px-3"><option value="all">{th ? "ทั้งหมด" : "All"}</option><option value="open">{th ? "เปิดบิล" : "Open"}</option><option value="paid">{th ? "ชำระแล้ว" : "Paid"}</option><option value="void">{th ? "ยกเลิก" : "Cancelled"}</option></select></Field>
              <Field label={th ? "การชำระเงิน" : "Payment"}><select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value as "all" | PaymentStatus)} className="h-10 w-full rounded-lg border border-slate-300 px-3"><option value="all">{th ? "ทั้งหมด" : "All"}</option><option value="unpaid">{th ? "ยังไม่ชำระ" : "Unpaid"}</option><option value="cash">{th ? "เงินสด" : "Cash"}</option><option value="bank_transfer">{th ? "โอนเงิน" : "Bank transfer"}</option></select></Field>
              <Field label={th ? "กะ" : "Shift"}><select value={shiftFilter} onChange={(event) => setShiftFilter(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3"><option value="all">{th ? "ทุกกะ" : "All shifts"}</option>{liveShiftOptions.map((shift) => <option key={shift.id} value={shift.id}>{shift.openedAt ? dateTimeFormatter.format(new Date(shift.openedAt)) : shift.id}</option>)}</select></Field>
              <Field label={th ? "ช่วงเวลา" : "Period"}><select value={quickRange} onChange={(event) => setQuickRange(event.target.value as QuickRange)} className="h-10 w-full rounded-lg border border-slate-300 px-3"><option value="day">{th ? "วันนี้" : "Today"}</option><option value="month">{th ? "เดือนนี้" : "This month"}</option><option value="year">{th ? "ปีนี้" : "This year"}</option><option value="custom">{th ? "วันที่ ถึง วันที่" : "Custom dates"}</option><option value="all">{th ? "ทั้งหมด" : "All dates"}</option></select></Field>
              {quickRange === "custom" ? <><Field label={th ? "จากวันที่" : "From date"}><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3" /></Field><Field label={th ? "ถึงวันที่" : "To date"}><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="h-10 w-full rounded-lg border border-slate-300 px-3" /></Field></> : null}
            </div>
            <div className="mt-4 flex justify-end"><button type="button" onClick={() => setFilterPopupOpen(false)} className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white">{th ? "ใช้ตัวกรอง" : "Apply filters"}</button></div>
          </div>
        </ModalLayer>
      ) : null}

      {selectedDetailRow ? (
        <ModalLayer z="z-50" onBackdrop={() => setSelectedDetailRow(null)}>
          <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-lg font-black">{th ? "รายละเอียดรายการขาย" : "Sales detail"} {selectedDetailRow.billNo}</h3><p className="mt-1 text-sm text-slate-500">{dateTimeFormatter.format(new Date(selectedDetailRow.openedAt))}</p></div><button type="button" onClick={() => setSelectedDetailRow(null)} className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-bold">{th ? "ปิด" : "Close"}</button></div>
            <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label={th ? "เลขบิล" : "Bill"} value={selectedDetailRow.billNo} />
              <Detail label={th ? "โต๊ะ/ช่องทาง" : "Table/channel"} value={`${selectedDetailRow.tableLabel} · ${channelLabel(selectedDetailRow.channel)}`} />
              <Detail label={th ? "ลูกค้า" : "Customer"} value={selectedDetailRow.customerName || "-"} />
              <Detail label={th ? "จำนวนรายการ" : "Items"} value={String(selectedDetailRow.items)} />
              <Detail label={th ? "ยอดสุทธิ" : "Net total"} value={`฿${money(selectedDetailRow.total, lang)}`} />
              <Detail label={th ? "ส่วนลด" : "Discount"} value={`฿${money(selectedDetailRow.discountAmount, lang)}`} />
              <Detail label={th ? "รับเงินสด" : "Cash received"} value={selectedDetailRow.cashReceived == null ? "-" : `฿${money(selectedDetailRow.cashReceived, lang)}`} />
              <Detail label={th ? "เงินทอน" : "Change"} value={selectedDetailRow.changeAmount == null ? "-" : `฿${money(selectedDetailRow.changeAmount, lang)}`} />
              <Detail label={th ? "ชำระเงิน" : "Payment"} value={paymentLabel(selectedDetailRow.paymentStatus)} />
              <Detail label={th ? "สถานะ" : "Status"} value={saleStatusLabel(selectedDetailRow.saleStatus)} />
              <Detail label={th ? "ผู้ทำรายการ" : "Cashier"} value={selectedDetailRow.cashier || "-"} />
              <Detail label={th ? "หมายเหตุ" : "Note"} value={selectedDetailRow.notes || "-"} />
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => void openBillItems(selectedDetailRow)} className="h-10 rounded-lg border border-indigo-200 bg-indigo-50 px-4 text-sm font-black text-indigo-700">{th ? "ดูรายการขายสินค้าต่อบิล" : "View products in this bill"}</button>
              {canManage && selectedDetailRow.saleStatus !== "void" ? <button type="button" onClick={() => requestAction({ type: "delete", row: selectedDetailRow, approvalAction: "sales_record_delete" })} disabled={mutationBusy} className="h-10 rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-black text-red-700 disabled:opacity-40">{th ? "ยกเลิกบิลและคืนสต๊อก" : "Cancel bill & restore stock"}</button> : null}
            </div>
          </div>
        </ModalLayer>
      ) : null}

      {billItemsOpen ? (
        <ModalLayer z="z-[70]" onBackdrop={() => setBillItemsOpen(false)}>
          <div className="w-full max-w-4xl rounded-2xl bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between"><div><h3 className="text-lg font-black">{th ? "รายการสินค้าต่อบิล" : "Products in bill"}</h3><p className="text-sm text-slate-500">{billItems?.order.bill_no ?? selectedDetailRow?.billNo ?? ""}</p></div><button type="button" onClick={() => setBillItemsOpen(false)} className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-bold">{th ? "ปิด" : "Close"}</button></div>
            {billItemsError ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{billItemsError}</p> : null}
            <div className="mt-4 max-h-[60vh] overflow-auto rounded-xl border border-slate-200">
              <table className="min-w-[760px] w-full text-sm"><thead className="sticky top-0 bg-slate-100 text-left text-xs font-bold text-slate-600"><tr><th className="px-3 py-3">{th ? "สินค้า" : "Product"}</th><th className="px-3 py-3">SKU</th><th className="px-3 py-3">{th ? "หมวดหมู่" : "Category"}</th><th className="px-3 py-3 text-right">{th ? "ราคา" : "Price"}</th><th className="px-3 py-3 text-right">{th ? "จำนวน" : "Qty"}</th><th className="px-3 py-3 text-right">{th ? "รวม" : "Total"}</th></tr></thead><tbody className="divide-y divide-slate-100">{billItemsLoading ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">{th ? "กำลังโหลด..." : "Loading..."}</td></tr> : !(billItems?.items.length) ? <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">{th ? "ไม่พบสินค้าในบิล" : "No bill items."}</td></tr> : billItems.items.map((item) => <tr key={item.id}><td className="px-3 py-3 font-bold">{item.name}</td><td className="px-3 py-3 text-slate-600">{item.sku ?? "-"}</td><td className="px-3 py-3 text-slate-600">{item.category ?? "-"}</td><td className="px-3 py-3 text-right">฿{money(item.unit_price, lang)}</td><td className="px-3 py-3 text-right font-bold">{formatQuantity(item.quantity, lang)}</td><td className="px-3 py-3 text-right font-bold">฿{money(item.line_total, lang)}</td></tr>)}</tbody></table>
            </div>
            {billItems ? <div className="mt-3 text-right text-base font-black">{th ? "รวมบิล" : "Bill total"}: ฿{money(billItems.order.total, lang)}</div> : null}
          </div>
        </ModalLayer>
      ) : null}

      {pinAction ? (
        <PosManagerApprovalModal
          open
          title={th ? "ยืนยัน PIN ผู้จัดการ/เจ้าของร้าน" : "Manager/owner PIN approval"}
          action={pinAction.approvalAction}
          targetTable="orders"
          targetId={pinAction.row.id}
          lang={lang}
          labels={{ pinLabel: th ? "PIN" : "PIN", pinKeypadHint: th ? "กรอก PIN เพื่อยืนยัน" : "Enter PIN to approve", pinLengthError: th ? "PIN ไม่ถูกต้อง" : "Invalid PIN length", pinRejected: th ? "PIN ไม่ถูกต้องหรือไม่มีสิทธิ์" : "PIN rejected", checkingAccess: th ? "กำลังตรวจสอบ..." : "Checking...", clear: th ? "ล้าง" : "Clear", remove: th ? "ลบ" : "Remove", closeAriaLabel: th ? "ปิด" : "Close" }}
          onClose={() => setPinAction(null)}
          onApproved={(approvalId) => { const action = pinAction; setPinAction(null); void runAuthorizedAction(action, approvalId); }}
        />
      ) : null}

      {editTarget ? (
        <ModalLayer z="z-50" onBackdrop={() => { if (!mutationBusy) setEditTarget(null); }}>
          <div className="w-full max-w-xl rounded-2xl bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between"><div><h3 className="text-lg font-black">{th ? "แก้ไขรายการขาย" : "Edit sales record"}</h3><p className="text-sm text-slate-500">{editTarget.row.billNo}</p></div><button type="button" onClick={() => { if (!mutationBusy) setEditTarget(null); }} className="h-9 rounded-lg border border-slate-300 px-3 text-sm font-bold">{th ? "ปิด" : "Close"}</button></div>
            <div className="mt-4 grid gap-3">
              <Field label={th ? "สถานะบิล" : "Bill status"}><select value={editSaleStatus} onChange={(event) => setEditSaleStatus(event.target.value as SaleStatus)} className="h-10 w-full rounded-lg border border-slate-300 px-3"><option value="open">{th ? "เปิดบิล" : "Open"}</option><option value="paid">{th ? "ชำระแล้ว" : "Paid"}</option><option value="void">{th ? "ยกเลิกและคืนสต๊อก" : "Cancel & restore stock"}</option></select></Field>
              {editSaleStatus !== "void" ? <Field label={th ? "การชำระเงิน" : "Payment"}><select value={editPaymentStatus} onChange={(event) => setEditPaymentStatus(event.target.value as PaymentStatus)} className="h-10 w-full rounded-lg border border-slate-300 px-3"><option value="unpaid">{th ? "ยังไม่ชำระ" : "Unpaid"}</option><option value="cash">{th ? "เงินสด" : "Cash"}</option><option value="bank_transfer">{th ? "โอนเงิน" : "Bank transfer"}</option></select></Field> : null}
              <Field label={th ? "หมายเหตุ" : "Note"}><textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 p-3 text-sm" /></Field>
              {editSaleStatus === "void" ? <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">{th ? "เมื่อบันทึก ระบบจะยกเลิกบิล คืนสต๊อกจากรายการตัดสต๊อกเดิม และตัดยอดชำระออกแบบครั้งเดียว" : "Saving will cancel the bill, restore stock exactly once, and remove captured payment."}</p> : null}
            </div>
            <div className="mt-4 flex justify-end"><button type="button" onClick={() => void saveEdit()} disabled={mutationBusy || (editSaleStatus === "paid" && editPaymentStatus === "unpaid")} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-black text-white disabled:opacity-40">{mutationBusy ? (th ? "กำลังบันทึก..." : "Saving...") : th ? "บันทึก" : "Save"}</button></div>
          </div>
        </ModalLayer>
      ) : null}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="rounded-xl border border-slate-200 bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-slate-900">{value}</p></article>;
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "slate" | "green" | "blue" | "orange" | "red" }) {
  const style = tone === "green" ? "border-green-200 bg-green-50 text-green-700" : tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-700" : tone === "orange" ? "border-orange-200 bg-orange-50 text-orange-700" : tone === "red" ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-700";
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${style}`}>{children}</span>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-bold text-slate-900">{value}</p></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1 text-xs font-bold text-slate-600"><span>{label}</span>{children}</label>;
}

function ModalLayer({ children, z, onBackdrop }: { children: React.ReactNode; z: string; onBackdrop: () => void }) {
  return <div className={`fixed inset-0 ${z} flex items-center justify-center bg-slate-900/50 p-4`} onClick={onBackdrop}>{children}</div>;
}
