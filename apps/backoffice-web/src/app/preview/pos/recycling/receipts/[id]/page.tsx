import Link from "next/link";
import { notFound } from "next/navigation";
import { RecyclingPrintReceiptButton } from "@/components/pos/recycling-print-receipt-button";
import { requirePosSession } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReceiptLine = {
  line_no: number;
  sku_snapshot: string;
  name_snapshot: string;
  category_snapshot: string;
  original_quantity: number;
  original_unit: string;
  base_unit: string;
  price_per_base: number;
  amount_minor: number;
};
const money = (minor: number) => new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(Number(minor) / 100);
const quantity = (value: number) =>
  new Intl.NumberFormat("th-TH", { maximumFractionDigits: 6 }).format(value);
const units: Record<string,string> = {
  kg: "กก.", khid: "ขีด", g: "กรัม",
  ton: "ตัน", piece: "ชิ้น", stem: "ต้น"
};
const paymentLabels: Record<string,string> = {
  cash: "เงินสด", bank_transfer: "เงินโอน",
  credit: "ค้างชำระ / เครดิต"
};

export default async function RecyclingReceiptPage({
  params
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id) || process.env.RECYCLING_STOCK_SCHEMA_READY !== "1") notFound();
  const scope = await requirePosSession();
  const { tenant_id: tenantId, branch_id: branchId, role } = scope.session;
  if (!["owner","manager","staff","accountant"].includes(role)) notFound();
  if (!await isAuthorizedRecyclingTenant(tenantId)) notFound();

  const db = getSupabaseServiceClient();
  const tx = await db.from("recycling_transactions")
    .select("id,receipt_no,direction,settlement,counterparty_name,total_minor,created_at,status")
    .eq("id",id).eq("tenant_id",tenantId).eq("branch_id",branchId).maybeSingle();
  if (tx.error || !tx.data || tx.data.status !== "posted") notFound();
  const [linesResult, tenantResult, branchResult] = await Promise.all([
    db.from("recycling_transaction_lines")
      .select("line_no,sku_snapshot,name_snapshot,category_snapshot,original_quantity,original_unit,base_unit,price_per_base,amount_minor")
      .eq("tenant_id",tenantId).eq("branch_id",branchId)
      .eq("transaction_id",id).order("line_no"),
    db.from("tenants").select("name,display_name").eq("id",tenantId).maybeSingle(),
    db.from("branches").select("name").eq("tenant_id",tenantId).eq("id",branchId).maybeSingle()
  ]);
  if (linesResult.error || !linesResult.data?.length) notFound();
  const lines = linesResult.data as ReceiptLine[];
  const totalLines = lines.reduce((sum,line) => sum + Number(line.amount_minor),0);
  if (totalLines !== Number(tx.data.total_minor)) notFound();

  const date = new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short"
  }).format(new Date(tx.data.created_at));
  const isBuy = tx.data.direction === "buy";
  const shopName = tenantResult.data?.display_name || tenantResult.data?.name || "ร้านค้าวัสดุรีไซเคิล";

  return <main className="mx-auto max-w-xl p-4 pb-10 print:m-0 print:w-[80mm] print:max-w-none print:p-0">
    <style>{`@media print {
      @page { size: 80mm auto; margin: 2mm; }
      html,body { background: white !important; }
      .recycling-receipt { box-shadow:none !important; border:none !important; }
    }`}</style>
    <nav className="mb-4 flex flex-wrap gap-2 print:hidden">
      <Link href="/preview/pos/recycling" className="rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700">
        กลับหน้ารับซื้อ–ขายออก
      </Link>
      <RecyclingPrintReceiptButton receiptId={id} />
    </nav>
    <article className="recycling-receipt rounded-lg border border-slate-200 bg-white px-4 py-5 font-sans text-[12px] leading-relaxed text-black shadow-sm">
      <header className="border-b border-dashed border-slate-500 pb-3 text-center">
        <h1 className="text-lg font-extrabold">{shopName}</h1>
        <p className="mt-1 text-xs">{branchResult.data?.name ?? "สาขา"}</p>
        <h2 className="mt-2 text-base font-extrabold">
          {isBuy ? "หลักฐานรับซื้อวัสดุรีไซเคิล" : "หลักฐานขายออกวัสดุรีไซเคิล"}
        </h2>
        <p className="text-[11px] font-bold">เอกสารการซื้อขายทั่วไป ไม่ใช่ใบกำกับภาษี</p>
      </header>
      <section className="space-y-1 border-b border-dashed border-slate-400 py-3">
        <div className="flex justify-between gap-2"><span>เลขที่อ้างอิง</span><strong>{tx.data.receipt_no}</strong></div>
        <div className="flex justify-between gap-2"><span>วันที่</span><span>{date}</span></div>
        <div className="flex justify-between gap-2"><span>{isBuy ? "ชื่อผู้ขายวัสดุ" : "ชื่อผู้ซื้อวัสดุ"}</span>
          <strong className="text-right">{tx.data.counterparty_name}</strong></div>
        <div className="flex justify-between gap-2"><span>วิธีชำระ</span>
          <span>{paymentLabels[tx.data.settlement] ?? tx.data.settlement}</span></div>
      </section>
      <table className="w-full text-[11px]">
        <thead><tr className="border-b border-slate-400 text-left">
          <th className="py-2">รายการ / น้ำหนัก</th>
          <th className="py-2 text-right">ราคา</th>
          <th className="py-2 text-right">รวม</th>
        </tr></thead>
        <tbody>{lines.map(line => <tr key={line.line_no} className="border-b border-dashed border-slate-200 align-top">
          <td className="py-2">
            <div className="font-bold">{line.name_snapshot}</div>
            <div className="text-[10px]">รหัส {line.sku_snapshot}</div>
            <div>{quantity(Number(line.original_quantity))} {units[line.original_unit] ?? line.original_unit}</div>
          </td>
          <td className="py-2 text-right">
            {money(Math.round(Number(line.price_per_base)*100))}
            <div className="text-[10px]">/{line.base_unit === "kg" ? "กก." : "ชิ้น"}</div>
          </td>
          <td className="py-2 text-right font-semibold">{money(Number(line.amount_minor))}</td>
        </tr>)}</tbody>
      </table>
      <div className="mt-4 flex justify-between border-t border-black pt-3 text-base font-extrabold">
        <span>รวมสุทธิ</span><span>{money(Number(tx.data.total_minor))} บาท</span>
      </div>
      <p className="mt-3 text-center text-[10px]">
        {tx.data.settlement === "credit"
          ? "รายการนี้ระบุเป็นเครดิต ยังไม่ถือว่าได้รับหรือจ่ายเงินสดแล้ว"
          : "โปรดตรวจสอบจำนวน น้ำหนัก และยอดเงินตามหลักฐานประกอบ"}
      </p>
      <p className="mt-3 break-all text-center text-[9px] text-slate-600">รหัสธุรกรรม: {id}</p>
      <p className="mt-3 border-t border-dashed border-slate-300 pt-2 text-center text-[10px]">CpiPOS CUSTOM Recycling</p>
    </article>
  </main>;
}
