"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FinanceSalesBranch, FinanceSalesRecordsPage } from "@/lib/finance-sales-analytics";
import type { FinanceDocumentDetail, FinanceReceiptLine, FinanceReceiptSnapshot } from "@/lib/server/finance-document-service";
import { formatSalesMoney } from "@/lib/pos-money";
import { FinanceDialog, FinanceConfirmDialog } from "./finance-dialog";

type Kind = "receipt" | "tax";
type ListPayload = { table: FinanceSalesRecordsPage; branches: FinanceSalesBranch[] };
type Buyer = { id: string; display_name: string; tax_id: string };
type BuyerForm = {
  entityType: string; displayName: string; taxId: string; addressLine: string;
  postalCode: string; subdistrict: string; district: string; province: string;
};
const newBuyer = (): BuyerForm => ({
  entityType: "company", displayName: "", taxId: "", addressLine: "",
  postalCode: "", subdistrict: "", district: "", province: ""
});
type Api<T> = { data?: T | null; error?: { code?: string; message?: string } | null };
type Edit = {
  documentDate: string; customerName: string; note: string;
  items: FinanceReceiptLine[]; discountAmount: number; taxAmount: number; totalAmount: number;
};
const field = "w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500";
const btn = "rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40";
const primary = "rounded-md bg-[#1369ae] px-4 py-2 text-xs font-bold text-white hover:bg-[#0b558e] disabled:cursor-not-allowed disabled:opacity-40";
const errorMessages: Record<string, string> = {
  finance_receipt_revision_conflict: "เอกสารนี้มีการแก้ไขจากผู้ใช้งานอื่นแล้ว กรุณาเปิดรายการใหม่อีกครั้ง",
  finance_document_total_mismatch: "ยอดรวมต้องตรงกับผลรวมรายการสินค้า หักส่วนลด และบวกภาษี",
  finance_correction_reason_required: "ระบุเหตุผลการแก้ไขอย่างน้อย 10 ตัวอักษร",
  finance_tax_invoice_requires_credit_or_replacement: "มีใบกำกับภาษีออกแล้ว ต้องแก้ผ่านกระบวนการยกเลิก/ใบลดหนี้/ออกเอกสารใหม่ ไม่สามารถแก้บิลต้นฉบับได้",
  finance_tax_invoice_already_exists: "ใบกำกับภาษีของบิลนี้ถูกออกแล้ว",
  finance_tax_vat_not_enabled: "ยังไม่ได้เปิดและยืนยันข้อมูล VAT ของสาขานี้",
  finance_tax_vat_verification_required: "ต้องให้ฝ่าย IT ตรวจสอบหลักฐาน ภ.พ.20 และยืนยันสิทธิ์ออกใบกำกับภาษีก่อน",
  finance_tax_seller_vat_profile_required: "ต้องตั้งค่าชื่อ ที่อยู่ และเลขผู้เสียภาษีของผู้ขายให้ครบก่อน",
  finance_tax_buyer_invalid: "ข้อมูลเลขประจำตัวผู้เสียภาษีของผู้ซื้อไม่ถูกต้อง",
  finance_tax_billed_tax_missing: "บิลนี้ไม่มีหลักฐานภาษีที่บันทึกไว้ จึงไม่ออก VAT ย้อนหลังโดยสมมติเอง",
  finance_receipt_audit_write_failed: "ไม่สามารถบันทึกหลักฐานการแก้ไขได้ จึงไม่ดำเนินการ",
  finance_tax_invoice_thb_only: "ระบบออกใบกำกับภาษีชุดนี้รองรับเฉพาะบิลสกุล THB",
  finance_document_items_invalid: "ต้องมีรายการสินค้า 1–100 รายการ",
  finance_receipt_already_void: "เอกสารฉบับนี้ถูกยกเลิกแล้ว",
  finance_tax_audit_reconcile_required: "มีการออกเอกสารแล้วแต่บันทึก Audit หลังออกไม่ครบ กรุณาติดต่อ IT ก่อนทำซ้ำ"
};
const money = (n: number, currency: FinanceReceiptSnapshot["currency"]) => formatSalesMoney(n, currency, "th-TH");
function bangkokDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const part = (kind: string) => parts.find(p => p.type === kind)?.value ?? "";
  return [part("year"), part("month"), part("day")].join("-");
}
function firstDate() {
  return bangkokDay(new Date(Date.now() - 6 * 86400_000));
}
function startEdit(receipt: FinanceReceiptSnapshot): Edit {
  return {
    documentDate: receipt.documentDate, customerName: receipt.customerName,
    note: receipt.note, items: receipt.items.map(item => ({ ...item })),
    discountAmount: receipt.discountAmount, taxAmount: receipt.taxAmount,
    totalAmount: receipt.totalAmount
  };
}
function recalc(items: FinanceReceiptLine[], discountAmount: number, taxAmount: number) {
  return Math.round((items.reduce((sum, line) => sum + line.lineTotal, 0) - discountAmount + taxAmount) * 100) / 100;
}
function printDocument(orderId: string, kind: Kind, width: 58 | 80) {
  const link = "/api/finance/documents/print?" + new URLSearchParams({ orderId, kind, width: String(width) });
  const popup = window.open(link, "_blank");
  if (!popup) return false;
  try { popup.opener = null; } catch { /* window may be protected */ }
  // The print page is same origin and rendered from the existing safe POS templates.
  // In locked-down browsers the user can also use Ctrl+P in the new tab.
  try { popup.addEventListener("load", () => popup.print(), { once: true }); } catch { /* popup may be detached */ }
  return true;
}

export function FinanceDocumentWorkspace({ kind }: { kind: Kind }) {
  const [from, setFrom] = useState(firstDate);
  const [to, setTo] = useState(bangkokDay);
  const [branchId, setBranchId] = useState("");
  const [billNo, setBillNo] = useState("");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState(0);
  const [list, setList] = useState<ListPayload | null>(null);
  const [selected, setSelected] = useState<FinanceDocumentDetail | null>(null);
  const [openingOrderId, setOpeningOrderId] = useState<string | null>(null);
  // Ignore a delayed detail response after closing its modal.
  const detailRequest = useRef(0);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [reason, setReason] = useState("");
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [buyerId, setBuyerId] = useState("");
  const [buyerForm, setBuyerForm] = useState<BuyerForm>(newBuyer);
  const [buyerModalOpen, setBuyerModalOpen] = useState(false);
  const [issueDialogOpen, setIssueDialogOpen] = useState(false);
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [buyerRefresh, setBuyerRefresh] = useState(0);
  const [paper, setPaper] = useState<58 | 80>(80);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDetail = useCallback(async (orderId: string, token?: number) => {
    const res = await fetch("/api/finance/documents?mode=detail&kind=" + kind + "&orderId=" + encodeURIComponent(orderId), { cache: "no-store" });
    const json = await res.json().catch(() => null) as Api<FinanceDocumentDetail> | null;
    if (!res.ok || !json?.data) throw new Error(json?.error?.code ?? "finance_receipt_detail_unavailable");
    if (token !== undefined && token !== detailRequest.current) return null;
    setSelected(json.data);
    setEdit(null);
    setReason("");
    return json.data;
  }, [kind]);

  const closeDetails = () => {
    if (working) return;
    detailRequest.current += 1;
    setOpeningOrderId(null);
    setSelected(null);
    setEdit(null);
    setReason("");
    setError("");
  };

  const openBill = async (orderId: string) => {
    if (working) return;
    const token = ++detailRequest.current;
    setSelected(null);
    setOpeningOrderId(orderId);
    setError("");
    try {
      await loadDetail(orderId, token);
    } catch (cause) {
      if (token === detailRequest.current) {
        const code = cause instanceof Error ? cause.message : "";
        setError(errorMessages[code] ?? code ?? "ไม่สามารถโหลดรายละเอียดบิลได้");
      }
    } finally {
      if (token === detailRequest.current) setOpeningOrderId(null);
    }
  };

  useEffect(() => {
    let alive = true;
    async function fetchList() {
      setLoading(true); setError("");
      const params = new URLSearchParams({ mode: "list", kind, from, to, page: String(page), billNo });
      if (branchId) params.set("branchId", branchId);
      try {
        const response = await fetch("/api/finance/documents?" + params.toString(), { cache: "no-store" });
        const json = await response.json().catch(() => null) as Api<ListPayload> | null;
        if (!response.ok || !json?.data) throw new Error(json?.error?.code ?? "finance_document_list_unavailable");
        if (alive) setList(json.data);
      } catch (cause) { if (alive) { setList(null); setError(cause instanceof Error ? cause.message : "รายการไม่พร้อมใช้งาน"); } }
      finally { if (alive) setLoading(false); }
    }
    void fetchList();
    return () => { alive = false; };
  }, [kind, from, to, branchId, billNo, page, query]);

  useEffect(() => {
    if (kind !== "tax" || !selected) { setBuyers([]); setBuyerId(""); return; }
    const branch = selected.receipt.branchId;
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/finance/documents?mode=buyers&branchId=" + encodeURIComponent(branch), { cache: "no-store" });
        const json = await response.json().catch(() => null) as Api<{ buyers: Buyer[] }> | null;
        if (alive) setBuyers(response.ok ? json?.data?.buyers ?? [] : []);
      } catch { if (alive) setBuyers([]); }
    })();
    return () => { alive = false; };
  }, [kind, selected?.receipt.branchId, buyerRefresh]);

  async function post(payload: Record<string, unknown>): Promise<boolean> {
    if (working) return false;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/finance/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await response.json().catch(() => null) as Api<unknown> | null;
      if (!response.ok) throw new Error(json?.error?.code ?? "finance_document_action_failed");

      // Close only after a confirmed server success. Failed saves leave the form
      // and all entered values intact so the user can correct them and retry.
      if (payload.action === "create_buyer") {
        const id = (json?.data as { id?: unknown } | null)?.id;
        if (typeof id === "string") setBuyerId(id);
        setBuyerForm(newBuyer());
        setBuyerModalOpen(false);
        setBuyerRefresh(n => n + 1);
      } else {
        if (payload.action === "issue_tax") setIssueDialogOpen(false);
        if (payload.action === "void") setVoidDialogOpen(false);
        if (payload.action === "correct") setEdit(null);
      }
      const successText = payload.action === "issue_tax" ? "ออกใบกำกับภาษีสำเร็จ เลือกพิมพ์สำเนาได้" :
        payload.action === "create_buyer" ? "บันทึกทะเบียนผู้ซื้อสำเร็จ และปิดหน้าต่างแล้ว" :
        payload.action === "void" ? "บันทึกการยกเลิกเอกสารแล้ว โดยเก็บบิล POS ต้นฉบับไว้" :
        "บันทึกใบเสร็จฉบับแก้ไขพร้อมประวัติการตรวจสอบแล้ว";
      setNotice(successText);
      setQuery(n => n + 1);
      if (payload.action !== "create_buyer" && selected) {
        try {
          await loadDetail(selected.receipt.orderId);
        } catch {
          setNotice(successText + " · กรุณาเปิดบิลอีกครั้งเพื่อโหลดข้อมูลล่าสุด");
        }
      }
      return true;
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(errorMessages[code] ?? code ?? "ทำรายการไม่สำเร็จ");
      return false;
    } finally {
      setWorking(false);
    }
  }

  const receipt = selected?.receipt;
  const invoice = selected?.invoice;
  return (
    <div className="space-y-3 px-3 pb-5 pt-3">
      <form onSubmit={event => { event.preventDefault(); setPage(1); setQuery(x => x + 1); }}
        className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.3fr_auto]">
        <label className="text-xs font-semibold text-slate-600">จากวันที่
          <input type="date" className={field + " mt-1"} value={from} onChange={event => setFrom(event.target.value)} />
        </label>
        <label className="text-xs font-semibold text-slate-600">ถึงวันที่
          <input type="date" className={field + " mt-1"} value={to} onChange={event => setTo(event.target.value)} />
        </label>
        <label className="text-xs font-semibold text-slate-600">สาขา
          <select value={branchId} className={field + " mt-1"} onChange={event => { setBranchId(event.target.value); setPage(1); }}>
            <option value="">ทุกสาขาที่ได้รับสิทธิ์</option>
            {(list?.branches ?? []).map(b => <option value={b.id} key={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600">เลขที่บิล
          <input type="search" className={field + " mt-1"} value={billNo} maxLength={80}
            placeholder="ค้นหาเลขบิล" onChange={event => setBillNo(event.target.value)} />
        </label>
        <div className="flex items-end"><button type="submit" className={primary}>ค้นหา</button></div>
      </form>

      {error ? <div role="alert" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div> : null}
      {notice ? <div role="status" className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</div> : null}

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3 text-xs">
          <b>{kind === "tax" ? "บิลสำหรับตรวจสอบใบกำกับภาษี" : "ใบเสร็จย้อนหลังจาก POS"}</b>
          <span>{loading ? "กำลังโหลด..." : `พบ ${list?.table.totalRows ?? 0} บิล`}</span>
        </div>
        <div className="max-h-[360px] overflow-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="sticky top-0 bg-[#e8f0fa] text-[#153f6e]"><tr>
              <th className="px-3 py-2.5">วันที่รับชำระ</th><th className="px-3 py-2.5">เลขที่บิล</th>
              <th className="px-3 py-2.5">สาขา</th><th className="px-3 py-2.5">สกุลเงิน</th>
              <th className="px-3 py-2.5 text-right">ยอดบิล</th><th className="px-3 py-2.5 text-right">รับชำระ</th>
              <th className="px-3 py-2.5 text-center">ดำเนินการ</th>
            </tr></thead>
            <tbody>{(list?.table.rows ?? []).map(row => (
              <tr key={row.orderId} className="border-t border-slate-100 even:bg-slate-50">
                <td className="whitespace-nowrap px-3 py-2">{new Date(row.completedAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</td>
                <td className="px-3 py-2 font-semibold text-blue-800">{row.orderNo}</td>
                <td className="px-3 py-2">{row.branchName}</td>
                <td className="px-3 py-2">{row.currency}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(row.billed, row.currency)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(row.received, row.currency)}</td>
                <td className="px-3 py-2 text-center">
                  <button type="button" className={btn}
                    disabled={working || openingOrderId !== null}
                    onClick={() => { void openBill(row.orderId); }}>
                    {openingOrderId === row.orderId ? "กำลังเปิด..." : "เลือกบิล"}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && !list?.table.rows.length ? <tr><td colSpan={7} className="p-8 text-center text-slate-500">ไม่พบรายการตามเงื่อนไข</td></tr> : null}
            </tbody>
          </table>
        </div>
        {list?.table ? <div className="flex items-center justify-end gap-2 border-t bg-slate-50 px-4 py-2 text-xs">
          <span>หน้า {list.table.page} / {list.table.totalPages}</span>
          <button type="button" className={btn} disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
          <button type="button" className={btn} disabled={page >= list.table.totalPages || loading} onClick={() => setPage(page + 1)}>ถัดไป</button>
        </div> : null}
      </section>

      {(openingOrderId !== null || (selected && receipt)) ? (
        <FinanceDialog open busy={working} size="xl" onClose={closeDetails}
          title={receipt ? (kind === "tax" ? "รายละเอียดใบกำกับภาษี" : "รายละเอียดใบเสร็จย้อนหลัง") : "กำลังเปิดรายละเอียดบิล"}
          description={receipt
            ? `บิล ${receipt.orderNo} · ${receipt.branchName} · ${receipt.currency} · ฉบับแก้ไข ${receipt.revision} · ${receipt.voided ? "ยกเลิกเอกสาร" : "ใช้งาน"}`
            : "กำลังอ่านข้อมูลจากระบบ POS ตามสิทธิ์สาขาของฝ่ายบัญชี"}>
          {receipt ? (
            <div className="space-y-5">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs font-semibold text-slate-600">ขนาดกระดาษ
                <select className={field + " mt-1"} value={paper} onChange={e => setPaper(Number(e.target.value) as 58 | 80)}>
                  <option value={58}>58 มม.</option><option value={80}>80 มม.</option>
                </select>
              </label>
              {kind === "receipt" ? <>
                <button type="button" className={primary} disabled={receipt.voided}
                  onClick={() => { if (!printDocument(receipt.orderId, "receipt", paper)) setError("ไม่สามารถเปิดหน้าพิมพ์ได้ กรุณาอนุญาต Pop-up"); }}>
                  พิมพ์ใบเสร็จย้อนหลัง
                </button>
                <button type="button" className={btn} disabled={receipt.voided || invoice?.status === "issued"}
                  onClick={() => { setEdit(startEdit(receipt)); setReason(""); }}>แก้ไขฉบับเอกสาร</button>
              </> : <>
                {invoice && invoice.status === "issued" ? (
                  <button type="button" className={primary}
                    onClick={() => { if (!printDocument(receipt.orderId, "tax", paper)) setError("ไม่สามารถเปิดหน้าพิมพ์ได้"); }}>
                    พิมพ์สำเนาใบกำกับภาษี · {invoice.invoiceNo}
                  </button>
                ) : (
                  <>
                    <label className="text-xs font-semibold text-slate-600">ผู้ซื้อจากทะเบียนภาษีของสาขา
                      <select className={field + " mt-1 min-w-[260px]"} value={buyerId} onChange={e => setBuyerId(e.target.value)}>
                        <option value="">เลือกผู้ซื้อที่มีเลขประจำตัวผู้เสียภาษี</option>
                        {buyers.map(b => <option key={b.id} value={b.id}>{b.display_name} · {b.tax_id}</option>)}
                      </select>
                    </label>
                    <button type="button" className={primary} disabled={!buyerId || working || receipt.revision !== 0}
                      onClick={() => { setError(""); setIssueDialogOpen(true); }}>
                      ตรวจสอบ VAT และออกใบกำกับภาษี
                    </button>
                  </>
                )}
              </>}
            </div>
            {kind === "tax" && !invoice ? (
              <button type="button" className={btn} disabled={working}
                onClick={() => { setError(""); setBuyerForm(newBuyer()); setBuyerModalOpen(true); }}>
                + เพิ่มผู้ซื้อสำหรับออกใบกำกับภาษี
              </button>
            ) : null}
            {kind === "receipt" && !edit ? (
              <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <div><p className="text-xs text-slate-500">วันที่ในเอกสาร</p><b>{receipt.documentDate}</b></div>
                <div><p className="text-xs text-slate-500">ชื่อผู้ซื้อ</p><b>{receipt.customerName || "—"}</b></div>
                <div><p className="text-xs text-slate-500">ยอดเอกสาร</p><b>{money(receipt.totalAmount, receipt.currency)}</b></div>
                <div><p className="text-xs text-slate-500">ยอดตามบิล POS ต้นฉบับ</p><b>{money(receipt.originalTotal, receipt.currency)}</b></div>
              </div>
            ) : null}
            {kind === "tax" ? (
              <p className="rounded border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
                ใช้ทะเบียนผู้ซื้อและข้อมูลภาษีจาก POS ของสาขานี้เท่านั้น ต้องเปิด VAT และมีเลขผู้เสียภาษีที่ถูกต้อง
                ใบกำกับภาษีที่ออกแล้วเก็บ Snapshot เดิม ไม่สามารถลบหรือแก้ยอดโดยตรง ต้องใช้กระบวนการใบลดหนี้/ยกเลิกเอกสารตามกฎหมาย
              </p>
            ) : null}
            {kind === "receipt" && !receipt.voided && invoice?.status !== "issued" ? (
              <button type="button" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                onClick={() => { setError(""); setReason(""); setVoidDialogOpen(true); }}>
                ยกเลิกเอกสารใบเสร็จ
              </button>
            ) : null}
            {selected?.revisions.length ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <b>ประวัติการแก้ไข/ยกเลิก</b>
                <ul className="mt-2 space-y-1">{selected.revisions.map(r =>
                  <li key={r.id}>{new Date(r.createdAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} · {r.action} · {r.reason}</li>
                )}</ul>
              </div>
            ) : null}
            <div className="flex justify-end border-t border-slate-200 pt-4">
              <button type="button" className={btn} disabled={working}
                onClick={closeDetails}>ปิดรายละเอียด</button>
            </div>
          </div>
          ) : (
            <div role="status" aria-live="polite" className="flex min-h-44 items-center justify-center gap-3 text-sm text-slate-600">
              <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
              กำลังโหลดรายละเอียดบิล...
            </div>
          )}
        </FinanceDialog>
      ) : null}
      {selected && receipt && kind === "tax" ? (
        <>
          <FinanceDialog open={buyerModalOpen} onClose={() => setBuyerModalOpen(false)}
            busy={working} title="เพิ่มผู้ซื้อสำหรับออกใบกำกับภาษี"
            description="บันทึกข้อมูลผู้ซื้อในทะเบียนภาษีของสาขาที่เลือก" size="xl">
            {error ? <p role="alert" className="mb-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}
            <form className="space-y-4" onSubmit={event => {
                  event.preventDefault();
                  void post({ action: "create_buyer",
                    profile: { ...buyerForm, branchId: receipt.branchId } });
                }}>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="text-xs">ประเภทผู้ซื้อ
                      <select className={field + " mt-1"} value={buyerForm.entityType}
                        onChange={e => setBuyerForm(b => ({ ...b, entityType: e.target.value }))}>
                        <option value="company">บริษัท</option><option value="limited_partnership">หจก.</option>
                        <option value="shop">ร้านค้า</option><option value="individual">บุคคลธรรมดา</option>
                      </select>
                    </label>
                    {([
                      ["displayName", "ชื่อผู้ซื้อ"], ["taxId", "เลขผู้เสียภาษี 13 หลัก"],
                      ["addressLine", "บ้านเลขที่ / ถนน"], ["postalCode", "รหัสไปรษณีย์"],
                      ["subdistrict", "ตำบล / แขวง"], ["district", "อำเภอ / เขต"],
                      ["province", "จังหวัด"]
                    ] as Array<[keyof BuyerForm, string]>).map(([key,label]) => (
                      <label key={key} className="text-xs">{label}
                        <input required className={field + " mt-1"} value={buyerForm[key]}
                          maxLength={key === "taxId" ? 13 : key === "postalCode" ? 5 : 240}
                          onChange={e => setBuyerForm(b => ({ ...b, [key]: e.target.value }))} />
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">ระบบตรวจสอบเลขผู้เสียภาษีและที่อยู่ให้ตรงกับรหัสไปรษณีย์ก่อนบันทึก</p>
                  <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                    <button type="button" className={btn} disabled={working}
                      onClick={() => setBuyerModalOpen(false)}>ยกเลิก</button>
                    <button className={primary} type="submit" disabled={working}>
                      {working ? "กำลังบันทึก..." : "บันทึกผู้ซื้อ"}
                    </button>
                  </div>
                </form>
          </FinanceDialog>
          <FinanceConfirmDialog open={issueDialogOpen} onClose={() => setIssueDialogOpen(false)}
            onConfirm={() => { if (buyerId) void post({ action: "issue_tax", orderId: receipt.orderId, buyerId }); }}
            title="ยืนยันออกใบกำกับภาษี"
            description="ออกเอกสารจากข้อมูล POS ต้นฉบับและทะเบียนผู้ซื้อที่เลือก โดยไม่สามารถแก้ไขใบกำกับภาษีที่ออกแล้วโดยตรง"
            confirmLabel="ตรวจสอบ VAT และยืนยันออกเอกสาร"
            busy={working} confirmDisabled={!buyerId || receipt.revision !== 0}>
            {error ? <p role="alert" className="mb-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs leading-6 text-blue-900">
              <p><b>เลขบิล:</b> {receipt.orderNo}</p>
              <p><b>สาขา:</b> {receipt.branchName}</p>
              <p><b>ผู้ซื้อ:</b> {buyers.find(b => b.id === buyerId)?.display_name ?? "ไม่พบผู้ซื้อ"}</p>
              <p><b>ยอดตามบิล:</b> {money(receipt.originalTotal, receipt.currency)}</p>
            </div>
          </FinanceConfirmDialog>
        </>
      ) : null}
      {selected && receipt && kind === "receipt" ? (
        <>
          <FinanceDialog open={Boolean(edit)} onClose={() => setEdit(null)}
            busy={working} title="แก้ไขใบเสร็จย้อนหลัง"
            description={`เลขบิล ${receipt.orderNo} · เอกสารฉบับแก้ไข ไม่เปลี่ยนรายการขาย POS ต้นฉบับ`} size="xl">
            {error ? <p role="alert" className="mb-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}
            {edit ? <form onSubmit={event => {
                event.preventDefault();
                void post({ action: "correct", orderId: receipt.orderId,
                  expectedRevision: receipt.revision, ...edit, reason });
              }} className="space-y-4">
                <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">บันทึกเป็นเอกสารฉบับแก้ไขที่ตรวจสอบย้อนหลังได้ ไม่เขียนทับยอดขายใน POS ต้นฉบับ</p>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <label className="text-xs">วันที่บนเอกสาร
                    <input type="date" required className={field + " mt-1"} value={edit.documentDate}
                      onChange={e => setEdit({ ...edit, documentDate: e.target.value })} /></label>
                  <label className="text-xs">ชื่อผู้ซื้อ
                    <input className={field + " mt-1"} maxLength={160} value={edit.customerName}
                      onChange={e => setEdit({ ...edit, customerName: e.target.value })} /></label>
                  <label className="text-xs">หมายเหตุ
                    <input className={field + " mt-1"} maxLength={1000} value={edit.note}
                      onChange={e => setEdit({ ...edit, note: e.target.value })} /></label>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[650px] text-xs">
                    <thead className="bg-[#e8f0fa]"><tr><th className="p-2 text-left">รายการ</th><th className="p-2">จำนวน</th>
                      <th className="p-2">ราคาต่อหน่วย</th><th className="p-2">รวม</th><th className="p-2">ลบแถว</th></tr></thead>
                    <tbody>{edit.items.map((line, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-1"><input className={field} maxLength={160} value={line.name}
                          onChange={e => setEdit(old => old && ({ ...old, items: old.items.map((it, i) => i === idx ? { ...it, name: e.target.value } : it) }))} /></td>
                        <td className="p-1"><input type="number" min="0.001" step="0.001" className={field + " w-24"} value={line.quantity}
                          onChange={e => setEdit(old => { if (!old) return old; const items = old.items.map((it,i) => i === idx ?
                            { ...it, quantity: Number(e.target.value), lineTotal: Math.round(Number(e.target.value) * it.unitPrice * 100) / 100 } : it);
                            return { ...old, items, totalAmount: recalc(items, old.discountAmount, old.taxAmount) }; })} /></td>
                        <td className="p-1"><input type="number" min="0" step="0.01" className={field + " w-24"} value={line.unitPrice}
                          onChange={e => setEdit(old => { if (!old) return old; const items = old.items.map((it,i) => i === idx ?
                            { ...it, unitPrice: Number(e.target.value), lineTotal: Math.round(it.quantity * Number(e.target.value) * 100) / 100 } : it);
                            return { ...old, items, totalAmount: recalc(items, old.discountAmount, old.taxAmount) }; })} /></td>
                        <td className="p-1 text-right tabular-nums">{line.lineTotal.toFixed(2)}</td>
                        <td className="p-1 text-center"><button type="button" className={btn} disabled={edit.items.length <= 1}
                          onClick={() => setEdit(old => { if (!old) return old; const items = old.items.filter((_,i) => i !== idx);
                            return { ...old, items, totalAmount: recalc(items,old.discountAmount,old.taxAmount) }; })}>ลบ</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                  <button type="button" className={btn + " mt-2"} onClick={() => setEdit(old => {
                    if (!old) return old;
                    const items = [...old.items, { name: "รายการใหม่", quantity: 1, unitPrice: 0, lineTotal: 0, note: "" }];
                    return { ...old, items, totalAmount: recalc(items, old.discountAmount, old.taxAmount) };
                  })}>+ เพิ่มรายการ</button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-xs">ส่วนลด
                    <input type="number" min="0" step="0.01" className={field + " mt-1"} value={edit.discountAmount}
                      onChange={e => setEdit(old => old && ({ ...old, discountAmount: Number(e.target.value),
                        totalAmount: recalc(old.items, Number(e.target.value), old.taxAmount) }))} /></label>
                  <label className="text-xs">ภาษีที่มีหลักฐาน
                    <input type="number" min="0" step="0.01" className={field + " mt-1"} value={edit.taxAmount}
                      onChange={e => setEdit(old => old && ({ ...old, taxAmount: Number(e.target.value),
                        totalAmount: recalc(old.items, old.discountAmount, Number(e.target.value)) }))} /></label>
                  <label className="text-xs">ยอดรวมเอกสาร
                    <input type="number" min="0" step="0.01" className={field + " mt-1"} value={edit.totalAmount}
                      onChange={e => setEdit({ ...edit, totalAmount: Number(e.target.value) })} /></label>
                </div>
                <label className="block text-xs font-semibold">เหตุผลการแก้ไข (บันทึก Audit Log)
                  <textarea className={field + " mt-1"} rows={2} minLength={10} maxLength={500} required value={reason}
                    onChange={e => setReason(e.target.value)} placeholder="ระบุสาเหตุและหลักฐานประกอบ" /></label>
                <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                  <button type="submit" disabled={working || reason.trim().length < 10} className={primary}>{working ? "กำลังบันทึก..." : "บันทึกฉบับแก้ไข"}</button>
                  <button type="button" className={btn} disabled={working} onClick={() => setEdit(null)}>ยกเลิกการแก้ไข</button>
                </div>
              </form> : null}
          </FinanceDialog>
          <FinanceConfirmDialog open={voidDialogOpen} onClose={() => setVoidDialogOpen(false)}
            onConfirm={() => { if (reason.trim().length >= 10) void post({ action: "void", orderId: receipt.orderId, expectedRevision: receipt.revision, reason }); }}
            title="ยืนยันยกเลิกใบเสร็จ" description="ยกเลิกเฉพาะเอกสารและบันทึกประวัติการดำเนินการ โดยไม่ลบยอดขายหรือรับชำระต้นฉบับ"
            confirmLabel="ยืนยันยกเลิกเอกสาร" danger busy={working}
            confirmDisabled={reason.trim().length < 10}>
            {error ? <p role="alert" className="mb-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}
            <label className="block text-xs font-semibold text-slate-700">เหตุผลการยกเลิก (อย่างน้อย 10 ตัวอักษร)
              <textarea className={field + " mt-2"} rows={3} minLength={10} maxLength={500}
                value={reason} onChange={e => setReason(e.target.value)} placeholder="ระบุเหตุผลและหลักฐานประกอบ" />
            </label>
          </FinanceConfirmDialog>
        </>
      ) : null}
    </div>
  );
}
