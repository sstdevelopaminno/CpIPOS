import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePosSession } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Entry = {
  id: string;
  transaction_id: string;
  account_code: string;
  account_name: string;
  debit_minor: number;
  credit_minor: number;
  line_no: number;
};

const amount = (minor: number) => new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(minor / 100);

export default async function RecyclingAccountingPage() {
  const scope = await requirePosSession();
  const role = scope.session.role;
  if (role !== "owner" && role !== "accountant") notFound();
  const tenantId = scope.session.tenant_id;
  const branchId = scope.session.branch_id;
  if (!await isAuthorizedRecyclingTenant(tenantId)) notFound();

  const db = getSupabaseServiceClient();
  const { data, error } = await db.from("recycling_accounting_entries")
    .select("id,transaction_id,account_code,account_name,debit_minor,credit_minor,line_no")
    .eq("tenant_id", tenantId).eq("branch_id", branchId)
    .order("transaction_id").order("line_no").limit(500);

  if (error) return <main className="mx-auto max-w-5xl space-y-4 p-5" role="alert">
    <h1 className="text-xl font-extrabold text-slate-900">บัญชีวัสดุรีไซเคิล</h1>
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
      ยังไม่สามารถแสดงรายการบัญชีได้ กรุณาตรวจสอบการติดตั้งฐานข้อมูล Recycling และสิทธิ์การเข้าถึง
      ไม่มีการสร้างรายการบัญชีจากการเปิดหน้านี้
    </p>
    <Link className="font-semibold text-blue-700" href="/preview/pos/recycling/stock">กลับตารางสต๊อก</Link>
  </main>;

  const entries = (data ?? []) as Entry[];
  const byTransaction = new Map<string, { debit: number; credit: number }>();
  for (const entry of entries) {
    const current = byTransaction.get(entry.transaction_id) ?? { debit: 0, credit: 0 };
    current.debit += Number(entry.debit_minor);
    current.credit += Number(entry.credit_minor);
    byTransaction.set(entry.transaction_id, current);
  }
  const unbalanced = Array.from(byTransaction.values()).filter(t => t.debit !== t.credit).length;
  const debitSum = entries.reduce((sum, entry) => sum + Number(entry.debit_minor), 0);
  const creditSum = entries.reduce((sum, entry) => sum + Number(entry.credit_minor), 0);

  return <main className="mx-auto max-w-6xl space-y-4 px-3 pb-8 pt-4 md:px-6">
    <header className="rounded-xl bg-blue-950 p-5 text-white">
      <p className="text-xs font-bold tracking-widest text-sky-200">CUSTOM · RECYCLING</p>
      <h1 className="mt-1 text-2xl font-extrabold">รายการเดบิต–เครดิตวัสดุรีไซเคิล</h1>
      <p className="mt-1 text-sm text-blue-100">แสดงเฉพาะสาขาที่ล็อกอินและรายการที่บันทึกแล้ว</p>
      <Link className="mt-3 inline-block rounded-lg border border-white/30 px-3 py-2 text-sm font-bold" href="/preview/pos/recycling/stock">
        กลับทะเบียนวัสดุ
      </Link>
    </header>
    <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      รายการนี้เป็นสมุดบัญชีย่อย (Subledger) สำหรับกระทบยอดก่อนโอนเข้าสมุดรายวันบัญชีหลัก
      ยังไม่ถือว่าโพสต์เข้าบัญชีแยกประเภทของระบบ Finance และยังไม่ใช่ใบกำกับภาษี
      กรุณาตรวจทานการอนุมัติและบัญชีที่ผูกก่อนการปิดงวด
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">เดบิตทั้งหมด (บาท)</p>
        <strong className="text-2xl text-blue-800">{amount(debitSum)}</strong></div>
      <div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">เครดิตทั้งหมด (บาท)</p>
        <strong className="text-2xl text-blue-800">{amount(creditSum)}</strong></div>
      <div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">ธุรกรรมเดบิต/เครดิตไม่สมดุล</p>
        <strong className={`text-2xl ${unbalanced ? "text-rose-700" : "text-emerald-700"}`}>{unbalanced}</strong></div>
    </div>
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[730px] text-sm">
        <thead className="bg-slate-100 text-left text-slate-700"><tr>
          <th className="px-3 py-3">เลขที่ธุรกรรม</th>
          <th className="px-3 py-3">รหัสบัญชี</th>
          <th className="px-3 py-3">บัญชี</th>
          <th className="px-3 py-3 text-right">เดบิต (บาท)</th>
          <th className="px-3 py-3 text-right">เครดิต (บาท)</th>
        </tr></thead>
        <tbody>{entries.length ? entries.map(entry => <tr key={entry.id} className="border-t border-slate-100">
          <td className="px-3 py-3 font-mono text-xs">{entry.transaction_id.slice(0, 12)}…</td>
          <td className="px-3 py-3 font-semibold">{entry.account_code}</td>
          <td className="px-3 py-3">{entry.account_name}</td>
          <td className="px-3 py-3 text-right">{entry.debit_minor ? amount(Number(entry.debit_minor)) : "—"}</td>
          <td className="px-3 py-3 text-right">{entry.credit_minor ? amount(Number(entry.credit_minor)) : "—"}</td>
        </tr>) : <tr><td colSpan={5} className="px-4 py-14 text-center text-slate-500">
          ยังไม่มีรายการบัญชีย่อยจากการซื้อขายจริง
        </td></tr>}</tbody>
      </table>
    </div>
    {entries.length === 500 && <p className="text-xs text-amber-700">แสดง 500 บรรทัดแรกเท่านั้น ต้องใช้รายงานแบบแบ่งหน้าเพื่อกระทบยอดทั้งงวด</p>}
  </main>;
}
