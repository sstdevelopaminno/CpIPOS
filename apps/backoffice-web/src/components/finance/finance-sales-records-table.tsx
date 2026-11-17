"use client";

import { formatSalesMoney, type SalesCurrencyCode } from "@/lib/pos-money";
import type { FinanceSalesRecordsPage, FinanceSalesRecent } from "@/lib/finance-sales-analytics";

function money(value: number, currency: SalesCurrencyCode) {
  return formatSalesMoney(value, currency, "th-TH");
}
function timestamp(value: string): string {
  return new Date(value).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
}
export function financePaymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    cash: "เงินสด", bank_transfer: "เงินโอน", bank: "ธนาคาร",
    promptpay: "พร้อมเพย์", qr: "QR", card: "บัตร", transfer: "เงินโอน",
    unknown: "ไม่ระบุช่องทาง"
  };
  return labels[method] ?? method;
}
function status(row: FinanceSalesRecent) {
  if (row.methods.length === 0) return {
    label: "ไม่พบรายการชำระ",
    className: "border-rose-200 bg-rose-50 text-rose-700"
  };
  if (row.unmatched) return {
    label: "ยอดไม่ตรง",
    className: "border-amber-200 bg-amber-50 text-amber-800"
  };
  return { label: "ยอดตรงกัน", className: "border-emerald-200 bg-emerald-50 text-emerald-800" };
}

export function FinanceSalesRecordsTable({
  table, busy, onPageChange
}: {
  table: FinanceSalesRecordsPage;
  busy: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm" aria-label="ตารางรายรับจากการขาย">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">รายการขายสินค้า · ข้อมูลจาก POS</h3>
          <p className="mt-0.5 text-xs text-slate-500">ค้นหาจากรายการทั้งหมดภายในช่วงวันที่และสาขาที่เลือก ไม่ใช่เฉพาะ 50 รายการล่าสุด</p>
        </div>
        <p className="text-xs font-semibold tabular-nums text-slate-600">พบ {table.totalRows.toLocaleString("th-TH")} รายการ</p>
      </div>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[1160px] border-collapse text-left text-xs" aria-label="รายการขายแบบอ่านอย่างเดียว">
          <thead className="sticky top-0 z-10 bg-[#eaf1fb] text-[#19385c]">
            <tr className="border-b border-[#bfd0e9]">
              <th scope="col" className="w-12 border-r border-[#d9e3f1] px-3 py-3 text-center">ลำดับ</th>
              <th scope="col" className="whitespace-nowrap px-3 py-3">วันที่รับชำระ</th>
              <th scope="col" className="whitespace-nowrap px-3 py-3">เลขที่บิล</th>
              <th scope="col" className="px-3 py-3">สาขา</th>
              <th scope="col" className="px-3 py-3">ช่องทางรับชำระ</th>
              <th scope="col" className="px-3 py-3 text-center">สกุลเงิน</th>
              <th scope="col" className="px-3 py-3 text-right">ยอดบิล</th>
              <th scope="col" className="px-3 py-3 text-right">ยอดรับชำระ</th>
              <th scope="col" className="px-3 py-3 text-right">ส่วนต่าง</th>
              <th scope="col" className="px-3 py-3 text-center">สถานะตรวจสอบ</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => {
              const rowStatus = status(row);
              return (
                <tr key={row.orderId} className="border-b border-slate-100 even:bg-[#f7faff] hover:bg-[#e9f2ff]">
                  <td className="border-r border-slate-100 px-3 py-2.5 text-center tabular-nums text-slate-500">
                    {(table.page - 1) * table.pageSize + index + 1}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{timestamp(row.completedAt)}</td>
                  <td className="px-3 py-2.5 font-semibold text-blue-800">{row.orderNo}</td>
                  <td className="px-3 py-2.5">{row.branchName}</td>
                  <td className="px-3 py-2.5">{row.methods.map(financePaymentMethodLabel).join(" + ") || "—"}</td>
                  <td className="px-3 py-2.5 text-center font-semibold">{row.currency}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(row.billed, row.currency)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(row.received, row.currency)}</td>
                  <td className={"whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums " +
                    (row.unmatched ? "text-amber-800" : "text-slate-600")}>
                    {money(row.billed - row.received, row.currency)}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={"inline-block whitespace-nowrap rounded border px-2 py-1 text-[11px] font-bold " + rowStatus.className}>
                      {rowStatus.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {table.rows.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-500">
                ไม่พบรายการตรงกับเงื่อนไขค้นหา ลองเปลี่ยนช่วงวันที่ เลขบิล หรือช่องทางรับชำระ
              </td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs">
        <p className="tabular-nums text-slate-600">
          หน้า {table.page.toLocaleString("th-TH")} / {table.totalPages.toLocaleString("th-TH")}
          {" "}· แสดง {table.rows.length.toLocaleString("th-TH")} รายการในหน้านี้
        </p>
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy || table.page <= 1} onClick={() => onPageChange(table.page - 1)}
            className="rounded border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40">
            ก่อนหน้า
          </button>
          <button type="button" disabled={busy || table.page >= table.totalPages} onClick={() => onPageChange(table.page + 1)}
            className="rounded border border-slate-300 bg-white px-3 py-2 font-semibold text-slate-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-40">
            ถัดไป
          </button>
        </div>
      </footer>
    </section>
  );
}
