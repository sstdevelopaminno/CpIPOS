"use client";
export function RecyclingPrintReceiptButton() {
  return <button type="button" onClick={() => window.print()}
    className="rounded-lg bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 print:hidden">
    พิมพ์ใบรับซื้อ / ใบขายออก
  </button>;
}
