"use client";

import { useEffect, useRef, useState } from "react";
import { FinanceDialog } from "./finance-dialog";

type Currency = "THB" | "LAK" | "USD";
type Branch = { id: string; name: string; code: string };
type Journal = {
  id: string; branchId: string; documentId: string; date: string;
  currency: Currency; debitMinor: number; creditMinor: number;
  postedAt: string; postedBy: string;
};
type JournalLine = {
  no: number; code: string; name: string; debitMinor: number; creditMinor: number;
};
type JournalDetail = {
  journal: Journal;
  lines: JournalLine[];
};
type ApiResponse<T> = { data: T | null; error: { code?: string; message?: string } | null };

const apiPath = "/api/finance/accounting";
const actionButton = "inline-flex min-h-9 items-center justify-center rounded-md border border-[#bfd0e3] bg-white px-3 text-[13px] font-semibold text-[#245483] hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50";
const selectStyle = "h-10 w-full min-w-0 rounded-md border border-[#bfcede] bg-white px-3 text-[13px] text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100";

function money(minor: number, currency: string) {
  const digits = currency === "LAK" ? 0 : 2;
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  }).format(minor / (digits ? 100 : 1));
}
function dateLabel(raw: string) {
  const stamp = Date.parse(raw + "T00:00:00Z");
  return Number.isFinite(stamp)
    ? new Date(stamp).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })
    : raw;
}
function postedLabel(raw: string) {
  const stamp = Date.parse(raw);
  return Number.isFinite(stamp)
    ? new Date(stamp).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "medium" })
    : "-";
}
async function fetchFinance<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
  const payload = await response.json().catch(() => null) as ApiResponse<T> | null;
  if (!response.ok || !payload?.data) {
    const code = payload?.error?.code ?? "finance_accounting_unavailable";
    if (code === "finance_accounting_not_enabled")
      throw new Error("ระบบสมุดรายวันยังไม่เปิดให้ใช้งาน");
    if (code === "finance_accounting_journals_too_many_filter_required")
      throw new Error("มีรายการมากกว่า 100 รายการ โปรดเลือกสาขาหรือใช้รายงานสำหรับช่วงเวลาที่จำกัด");
    throw new Error("ไม่สามารถโหลดสมุดรายวันได้ (" + code + ")");
  }
  return payload.data;
}

/** Read-only posted-journal register. No document creation, GL mutation, or POS posting. */
export function FinancePostedJournals() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branch, setBranch] = useState("");
  const [journals, setJournals] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Journal | null>(null);
  const [detail, setDetail] = useState<JournalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const detailRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void fetchFinance<{ branches: Branch[] }>(apiPath + "?view=branches")
      .then(result => {
        if (cancelled) return;
        setBranches(result.branches);
        setBranch(current => result.branches.some(item => item.id === current)
          ? current : result.branches[0]?.id ?? "");
        if (!result.branches.length) {
          setError("ยังไม่มีสาขาที่ได้รับสิทธิ์สำหรับตรวจสอบสมุดรายวัน");
          setLoading(false);
        }
      })
      .catch(cause => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "ไม่สามารถโหลดสาขาได้");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!branch) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchFinance<{ journals: Journal[] }>(
      apiPath + "?view=journals&branchId=" + encodeURIComponent(branch)
    ).then(result => {
      if (cancelled) return;
      setJournals(result.journals);
    }).catch(cause => {
      if (cancelled) return;
      setJournals([]);
      setError(cause instanceof Error ? cause.message : "ไม่สามารถโหลดสมุดรายวันได้");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [branch, refreshToken]);

  function closeDetail() {
    detailRequest.current++;
    setSelected(null);
    setDetail(null);
    setDetailError("");
    setDetailLoading(false);
  }

  async function openDetail(item: Journal) {
    const token = ++detailRequest.current;
    setSelected(item);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const result = await fetchFinance<JournalDetail>(
        apiPath + "?view=journal_detail&journalId=" + encodeURIComponent(item.id)
      );
      if (token === detailRequest.current) setDetail(result);
    } catch (cause) {
      if (token === detailRequest.current)
        setDetailError(cause instanceof Error ? cause.message : "ไม่สามารถเปิดรายละเอียดได้");
    } finally {
      if (token === detailRequest.current) setDetailLoading(false);
    }
  }

  return (
    <div className="w-full min-w-0 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d3dfec] bg-[#f3f7fc] px-5 py-4">
        <div>
          <h2 className="text-[14px] font-extrabold text-[#204b79]">ทะเบียนสมุดรายวันที่โพสต์แล้ว</h2>
          <p className="mt-1 text-[12px] leading-5 text-slate-500">
            อ่านข้อมูลจากฐานข้อมูลบัญชีโดยตรง · แสดงเฉพาะรายการที่โพสต์แล้ว · ไม่สร้างหรือแก้ไขรายการ
          </p>
        </div>
        <button type="button" className={actionButton} onClick={() => setRefreshToken(x => x + 1)}
          disabled={loading || !branch}>โหลดใหม่</button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-3">
        <div className="w-full max-w-[420px]">
          <label htmlFor="finance-posted-journal-branch" className="mb-1.5 block text-xs font-bold text-slate-600">สาขา</label>
          <select id="finance-posted-journal-branch" className={selectStyle} value={branch}
            onChange={event => setBranch(event.target.value)} disabled={!branches.length}>
            {!branches.length && <option value="">ยังไม่มีสาขา</option>}
            {branches.map(item => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}
          </select>
        </div>
        <p role="status" className="pb-1 text-[12px] text-slate-500">
          {loading ? "กำลังตรวจสอบรายการ..." : error ? "ไม่สามารถแสดงรายการ" : "พบ " + journals.length + " รายการ"}
        </p>
      </div>

      {error && <p role="alert" className="mx-5 my-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">{error}</p>}

      <div className="w-full overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-[13px]">
          <thead className="bg-[#e9f0f9] text-[#315377]">
            <tr>
              <th scope="col" className="whitespace-nowrap px-5 py-3 text-left font-bold">วันที่บัญชี</th>
              <th scope="col" className="whitespace-nowrap px-5 py-3 text-left font-bold">วันที่โพสต์</th>
              <th scope="col" className="px-5 py-3 text-left font-bold">รหัสเอกสารต้นทาง</th>
              <th scope="col" className="px-5 py-3 text-right font-bold">เดบิต</th>
              <th scope="col" className="px-5 py-3 text-right font-bold">เครดิต</th>
              <th scope="col" className="px-5 py-3 text-left font-bold">สกุลเงิน</th>
              <th scope="col" className="px-5 py-3 text-right font-bold">รายละเอียด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {journals.map(item => (
              <tr key={item.id} className="hover:bg-[#f8fbff]">
                <td className="whitespace-nowrap px-5 py-3 tabular-nums">{dateLabel(item.date)}</td>
                <td className="whitespace-nowrap px-5 py-3 tabular-nums">{postedLabel(item.postedAt)}</td>
                <td className="px-5 py-3 font-mono text-xs text-[#20578f]">{item.documentId}</td>
                <td className="px-5 py-3 text-right tabular-nums">{money(item.debitMinor, item.currency)}</td>
                <td className="px-5 py-3 text-right tabular-nums">{money(item.creditMinor, item.currency)}</td>
                <td className="px-5 py-3">{item.currency}</td>
                <td className="px-5 py-2 text-right">
                  <button type="button" className={actionButton} onClick={() => { void openDetail(item); }}>
                    ดูเดบิต–เครดิต
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !error && journals.length === 0 && (
          <p className="px-5 py-9 text-center text-[13px] text-slate-500">
            ยังไม่มีรายการที่ผ่านการลงบัญชีในสาขานี้
          </p>
        )}
      </div>

      <FinanceDialog open={Boolean(selected)} title="รายละเอียดสมุดรายวันที่โพสต์แล้ว"
        description="ข้อมูลเดบิต–เครดิตจากรายการบัญชีที่โพสต์แล้ว ไม่แก้ไขยอดต้นทาง"
        onClose={closeDetail} size="lg">
        {detailLoading && <p role="status" className="py-5 text-[13px] text-slate-500">กำลังอ่านรายละเอียด...</p>}
        {detailError && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800">{detailError}</p>}
        {detail && (
          <>
            <div className="mb-4 grid gap-3 rounded-md bg-[#f1f6fc] px-4 py-3 text-[13px] sm:grid-cols-2">
              <p>วันที่บัญชี <strong>{dateLabel(detail.journal.date)}</strong></p>
              <p>วันที่โพสต์ <strong>{postedLabel(detail.journal.postedAt)}</strong></p>
              <p className="break-all sm:col-span-2">เอกสารต้นทาง <strong className="font-mono text-xs">{detail.journal.documentId}</strong></p>
            </div>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[500px] text-[13px]">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left">รหัสบัญชี</th>
                    <th scope="col" className="px-4 py-3 text-left">ชื่อบัญชี</th>
                    <th scope="col" className="px-4 py-3 text-right">เดบิต</th>
                    <th scope="col" className="px-4 py-3 text-right">เครดิต</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detail.lines.map(line => (
                    <tr key={line.no}>
                      <td className="px-4 py-3 font-semibold">{line.code}</td>
                      <td className="px-4 py-3">{line.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{line.debitMinor ? money(line.debitMinor, detail.journal.currency) : "-"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{line.creditMinor ? money(line.creditMinor, detail.journal.currency) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-[#c3d9ef] bg-[#ecf4ff] font-bold">
                  <tr>
                    <td colSpan={2} className="px-4 py-3">รวม ({detail.journal.currency})</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(detail.journal.debitMinor, detail.journal.currency)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(detail.journal.creditMinor, detail.journal.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
        <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
          <button type="button" className={actionButton} onClick={closeDetail}>ปิดรายละเอียด</button>
        </div>
      </FinanceDialog>
    </div>
  );
}
