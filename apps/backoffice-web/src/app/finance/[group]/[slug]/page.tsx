import { notFound } from "next/navigation";
import { FinanceSalesDashboard } from "@/components/finance/finance-sales-dashboard";
import { FinanceDocumentWorkspace } from "@/components/finance/finance-document-workspace";
import { FinanceSectionHeader } from "@/app/finance/finance-section-header";
import {
  accountantMenuItem
} from "@/lib/accountant-menu-policy";
import { requireAccountantPage } from "@/lib/server/accountant-page-guard";
import {
  loadAccountantProductCatalog, loadAccountantProductSales, loadAccountantStoreOverview
} from "@/lib/server/finance-accountant-readonly-services";
import { formatSalesMoney } from "@/lib/pos-money";

export const dynamic = "force-dynamic";

const panel = "min-w-0 bg-white";
const cell = "border-b border-slate-100 px-4 py-3 text-left text-xs leading-5";

export default async function AccountantFeaturePage({ params }: {
  params: Promise<{ group: string; slug: string }>
}) {
  const { group, slug } = await params;
  const item = accountantMenuItem(group, slug);
  if (!item) notFound();
  const identity = await requireAccountantPage(item.key);
  const summaryView = group === "more" && slug === "sales-summary";
  const receiptView = group === "more" && slug === "receipts";
  const productSalesView = group === "more" && slug === "product-sales";
  const catalogView = group === "more" && slug === "stock";
  const storeView = group === "settings" && (slug === "store" || slug === "branches");
  const taxView = group === "more" && slug === "tax-invoices";

  let productSales: Awaited<ReturnType<typeof loadAccountantProductSales>> | null = null;
  let products: Awaited<ReturnType<typeof loadAccountantProductCatalog>> | null = null;
  let store: Awaited<ReturnType<typeof loadAccountantStoreOverview>> | null = null;
  let dataError: string | null = null;
  try {
    if (productSalesView) productSales = await loadAccountantProductSales(identity);
    if (catalogView) products = await loadAccountantProductCatalog(identity);
    if (storeView) store = await loadAccountantStoreOverview(identity);
  } catch {
    dataError = "ยังโหลดข้อมูลจากระบบ POS ไม่สำเร็จ กรุณาลองอีกครั้งหรือติดต่อฝ่าย IT";
  }

  return (
    <section className="finance-secondary-workbench w-full min-w-0 bg-white text-slate-900">
      {!summaryView ? <FinanceSectionHeader title={item.label} group={group as "more" | "settings"}
        subtitle={`ฝ่ายบัญชี · ${identity.branchIds.length} สาขาที่ได้รับสิทธิ์`} /> : null}
      <div className="w-full min-w-0 divide-y divide-slate-200 bg-white">
      {summaryView ? <FinanceSalesDashboard actor="accountant" initialTab="dashboard" /> : null}
      {receiptView ? <FinanceDocumentWorkspace kind="receipt" /> : null}
      {taxView ? <FinanceDocumentWorkspace kind="tax" /> : null}

      {dataError ? <div role="alert" className="mx-5 my-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">{dataError}</div> : null}

      {productSales ? (
        <section className={panel + " overflow-hidden border-b border-slate-200"}>
          <div className="border-b border-slate-200 bg-[#f3f6fa] px-5 py-3 text-sm font-bold leading-6">
            สรุปรายการขายสินค้า 7 วัน ({productSales.from} ถึง {productSales.to}) · {productSales.orders} บิลสำเร็จ
          </div>
          <p className="px-5 py-3 text-xs leading-5 text-slate-500">
            ยอดตามบรรทัดสินค้า ยังไม่ใช่ยอดสุทธิหลังส่วนลดทั้งบิลหรือภาษี และแยกสกุลเงินเสมอ
          </p>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[740px] text-xs">
              <thead className="sticky top-0 bg-[#e8f0fa] text-[#183b62]">
                <tr><th className={cell}>สาขา</th><th className={cell}>รายการสินค้า</th>
                  <th className={cell}>สกุลเงิน</th><th className={cell + " text-right"}>จำนวน</th>
                  <th className={cell + " text-right"}>ยอดตามบรรทัด</th>
                  <th className={cell + " text-right"}>รายการ</th></tr>
              </thead>
              <tbody>
                {productSales.rows.map((row, index) => (
                  <tr className="even:bg-slate-50" key={index}>
                    <td className={cell}>{row.branchName}</td><td className={cell}>{row.product}</td>
                    <td className={cell}>{row.currency}</td>
                    <td className={cell + " text-right"}>{row.quantity.toLocaleString("th-TH")}</td>
                    <td className={cell + " text-right"}>{formatSalesMoney(row.lineTotal, row.currency, "th-TH")}</td>
                    <td className={cell + " text-right"}>{row.lines}</td>
                  </tr>
                ))}
                {!productSales.rows.length ? <tr><td colSpan={6} className="p-6 text-center text-slate-500">ยังไม่มีรายการขายสินค้าในช่วง 7 วันที่ผ่านมา</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {products ? (
        <section className={panel + " overflow-hidden border-b border-slate-200"}>
          <div className="border-b border-slate-200 bg-[#f3f6fa] px-5 py-3 text-sm font-bold leading-6">
            สินค้าที่เปิดใช้งาน ({products.length} รายการ) · แสดงเพื่อการตรวจสอบ
          </div>
          <p className="px-5 py-3 text-xs leading-5 text-slate-500">
            หน้านี้เป็นทะเบียนสินค้าแบบอ่านอย่างเดียว ไม่แสดงยอดคงเหลือ และยังไม่อนุญาตเพิ่ม ลบ หรือแก้สินค้าใน Session บัญชี
          </p>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[680px] text-xs">
              <thead className="sticky top-0 bg-[#e8f0fa] text-[#183b62]">
                <tr><th className={cell}>รหัสสินค้า</th><th className={cell}>ชื่อสินค้า</th>
                  <th className={cell}>หมวด</th><th className={cell}>ประเภทสาขา</th>
                  <th className={cell + " text-right"}>ราคาที่บันทึก</th></tr>
              </thead>
              <tbody>
                {products.map(row => (
                  <tr key={row.id} className="even:bg-slate-50">
                    <td className={cell}>{row.sku ?? "—"}</td><td className={cell}>{row.name}</td>
                    <td className={cell}>{row.category ?? "—"}</td>
                    <td className={cell}>{row.branchId ? "เฉพาะสาขา" : "ทั้งร้าน"}</td>
                    <td className={cell + " text-right"}>{row.price?.toLocaleString("th-TH") ?? "—"}</td>
                  </tr>
                ))}
                {!products.length ? <tr><td colSpan={5} className="p-6 text-center text-slate-500">ไม่มีข้อมูลสินค้า</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {store ? (
        <section className={panel + " border-b border-slate-200 px-5 py-5"}>
          <h2 className="text-sm font-bold">ข้อมูลร้านค้า (อ่านอย่างเดียว)</h2>
          <p className="mt-2 text-base font-bold">{store.name}</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">สถานะร้าน: {store.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="bg-[#e8f0fa]"><tr><th className={cell}>รหัสสาขา</th>
                <th className={cell}>ชื่อสาขา</th><th className={cell}>สถานะ</th></tr></thead>
              <tbody>{store.branches.map(branch => (
                <tr key={branch.id}><td className={cell}>{branch.code}</td>
                  <td className={cell}>{branch.name}</td>
                  <td className={cell}>{branch.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">การแก้ไขที่อยู่บริษัท การเพิ่มสาขา และการกำหนดเครื่องยังต้องผ่านขั้นตอนอนุมัติและสิทธิ์ที่เหมาะสม</p>
        </section>
      ) : null}

      {group === "settings" && !storeView ? (
        <section className={panel + " border-b border-slate-200 px-5 py-5"}>
          <h2 className="text-sm font-bold">การตั้งค่า {item.label}</h2>
          <p className="mt-2 text-sm text-slate-600">
            เปิดหน้าเมนูและสิทธิ์เรียบร้อยแล้ว แต่ยังไม่อนุญาตให้ Session บัญชีเปลี่ยนการตั้งค่าจริง
            เพื่อป้องกันการแก้ไขสิทธิ์สาขา เครื่องรับชำระ และข้อมูลภาษีโดยไม่มีขั้นตอนยืนยัน
          </p>
          <p className="mt-3 text-xs leading-5 text-slate-500">เลือกหมวดที่เกี่ยวข้องด้านล่างได้ โดยแต่ละหน้าตรวจสอบสิทธิ์กับนโยบาย IT แยกกัน</p>
        </section>
      ) : null}


      </div>
    </section>
  );
}
