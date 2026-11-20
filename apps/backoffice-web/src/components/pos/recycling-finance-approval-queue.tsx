"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export type RecyclingFinancePendingTransaction = {
  id: string;
  receipt_no: string;
  direction: "buy" | "sell";
  counterparty_name: string;
  total_minor: number;
  cogs_minor: number;
  status: "posted" | "voided";
  created_at: string;
  finance_document_id: string | null;
};

const currency = (minor: number) => new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(Number(minor) / 100);

export function RecyclingFinanceApprovalQueue({
  transactions,
  canPost,
  postingEnabled
}: {
  transactions: RecyclingFinancePendingTransaction[];
  canPost: boolean;
  postingEnabled: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  async function approveAndPost(id: string) {
    if (!canPost || !postingEnabled || submitting) return;
    if (!window.confirm("ยืนยันว่าตรวจสอบเอกสาร ต้นทุน การลงบัญชี และความถูกต้องของคู่ค้าแล้ว ต้องการอนุมัติบันทึกเข้าบัญชีแยกประเภทหรือไม่?")) return;
    setError("");
    setResult("");
    setSubmitting(id);
    try {
      const response = await fetch("/api/pos/recycling/accounting/post", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transaction_id: id })
      });
      const body = await response.json().catch(() => null) as {
        data?: { posting?: { journal_id?: string } };
        error?: { code?: string; message?: string };
      } | null;
      if (!response.ok || !body?.data?.posting?.journal_id) {
        setError(body?.error?.message ?? "ไม่สามารถโพสต์รายการเข้าบัญชีได้ ไม่มีการยืนยันสำเร็จ");
        return;
      }
      setResult("โพสต์เข้าบัญชีแยกประเภทแล้ว เลขที่สมุดรายวัน: " + body.data.posting.journal_id);
      router.refresh();
    } catch {
      setError("การเชื่อมต่อขัดข้อง โปรดตรวจสอบรายการบัญชีก่อนส่งอนุมัติซ้ำ");
    } finally {
      setSubmitting("");
    }
  }

  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="border-b border-slate-200 p-4">
      <h2 className="font-extrabold text-slate-900">คิวตรวจสอบและโพสต์บัญชีซื้อ–ขายวัสดุ</h2>
      <p className="mt-1 text-sm text-slate-600">
        แสดง 100 รายการล่าสุดของสาขาเท่านั้น การโพสต์บัญชีต้องให้พนักงานบัญชีคนละคนกับผู้บันทึกต้นทางอนุมัติ
      </p>
    </div>
    {!postingEnabled && <div role="note" className="m-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
      ระบบปิดปุ่มโพสต์บัญชีจริงระหว่างทดสอบ Migration, สิทธิ์, ผังบัญชี และการกระทบยอด
    </div>}
    {error && <p role="alert" className="m-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
    {result && <p role="status" className="m-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{result}</p>}
    <div className="overflow-x-auto">
      <table className="w-full min-w-[850px] text-sm">
        <thead className="bg-slate-100 text-left text-slate-700"><tr>
          <th className="px-3 py-3">วันที่ / เลขอ้างอิง</th>
          <th className="px-3 py-3">ทิศทาง</th>
          <th className="px-3 py-3">คู่ค้า</th>
          <th className="px-3 py-3 text-right">ยอดรายการ (บาท)</th>
          <th className="px-3 py-3 text-right">ต้นทุนขาย (บาท)</th>
          <th className="px-3 py-3">สถานะบัญชี</th>
          <th className="px-3 py-3 text-right">ตรวจสอบ</th>
        </tr></thead>
        <tbody>{transactions.length ? transactions.map(tx => <tr key={tx.id} className="border-t border-slate-100 align-top">
          <td className="px-3 py-3">
            <strong className="block font-mono text-xs">{tx.receipt_no}</strong>
            <small className="text-slate-500">{new Date(tx.created_at).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" })}</small>
          </td>
          <td className="px-3 py-3">{tx.direction === "buy" ? "รับซื้อ" : "ขายออก"}</td>
          <td className="px-3 py-3">{tx.counterparty_name}</td>
          <td className="px-3 py-3 text-right font-semibold">{currency(tx.total_minor)}</td>
          <td className="px-3 py-3 text-right">{tx.direction === "sell" ? currency(tx.cogs_minor) : "—"}</td>
          <td className="px-3 py-3">{tx.status==="voided"
            ? <span className="font-semibold text-rose-700">เอกสารยกเลิก VOID</span>
            : tx.finance_document_id
            ? <span className="font-semibold text-emerald-700">โพสต์แล้ว</span>
            : <span className="font-semibold text-amber-700">รอตรวจสอบ</span>}</td>
          <td className="space-y-2 px-3 py-3 text-right">
            <Link className="block rounded border border-slate-200 px-3 py-2 text-center font-semibold text-slate-700"
              href={`/preview/pos/recycling/receipts/${tx.id}`}>ตรวจใบรับซื้อ–ขาย</Link>
            {canPost && tx.status==="posted" && !tx.finance_document_id && <button type="button"
              className="w-full rounded-lg bg-blue-700 px-3 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!postingEnabled || Boolean(submitting)}
              onClick={() => void approveAndPost(tx.id)}>
              {submitting === tx.id ? "กำลังโพสต์..." : "อนุมัติโพสต์ GL"}
            </button>}
          </td>
        </tr>) : <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-500">
          ยังไม่มีธุรกรรมรับซื้อหรือขายออกสำหรับกระทบยอด
        </td></tr>}</tbody>
      </table>
    </div>
    {transactions.length === 100 && <p className="p-3 text-xs text-amber-700">
      ตารางนี้แสดงเฉพาะรายการล่าสุด 100 รายการ ต้องใช้รายงานแบ่งหน้าในการตรวจสอบย้อนหลังทั้งหมด
    </p>}
  </section>;
}
