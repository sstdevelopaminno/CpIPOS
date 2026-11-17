import Link from "next/link";
import { notFound } from "next/navigation";
import { FinanceSalesDashboard } from "@/components/finance/finance-sales-dashboard";
import {
  ACCOUNTANT_MORE_MENU, ACCOUNTANT_SETTINGS_MENU, accountantMenuItem, isAccountantMenuVisible
} from "@/lib/accountant-menu-policy";
import { requireAccountantPage } from "@/lib/server/accountant-page-guard";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";
import {
  loadAccountantProductCatalog, loadAccountantProductSales, loadAccountantStoreOverview
} from "@/lib/server/finance-accountant-readonly-services";
import { formatSalesMoney } from "@/lib/pos-money";

export const dynamic = "force-dynamic";

const panel = "rounded-lg border border-slate-200 bg-white shadow-sm";
const cell = "border-b border-slate-100 px-3 py-2.5 text-left text-xs";

export default async function AccountantFeaturePage({ params }: {
  params: Promise<{ group: string; slug: string }>
}) {
  const { group, slug } = await params;
  const item = accountantMenuItem(group, slug);
  if (!item) notFound();
  const identity = await requireAccountantPage(item.key);
  const overrides = await getTenantPosMenuOverrides(identity.tenantId);
  const related = (group === "more" ? ACCOUNTANT_MORE_MENU : ACCOUNTANT_SETTINGS_MENU)
    .filter(entry => isAccountantMenuVisible(entry.key, overrides));
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
    <section className="w-full min-w-0 space-y-4 text-slate-900">
      <header className={panel + " p-4"}>
        <p className="text-xs font-bold text-blue-700">
          {group === "more" ? "เพิ่มเติม" : "ตั้งค่า"} · CpiPOS FINANCE · ฝ่ายบัญชี
        </p>
        <h1 className="mt-1 text-xl font-extrabold">{item.label}</h1>
        <p className="mt-2 text-xs text-slate-500">
          ข้อมูลเฉพาะร้านที่เข้าสู่ระบบ · {identity.branchIds.length} สาขาที่ได้รับสิทธิ์ · ไม่มีสิทธิ์เปิดกะหรือแก้รายการขาย
        </p>
      </header>

      {summaryView ? <FinanceSalesDashboard actor="accountant" initialTab="dashboard" /> : null}
      {receiptView ? (
        <>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-xs text-sky-900">
            ประวัติด้านล่างเป็นรายการบิลขายสำเร็จจาก POS แบบอ่านอย่างเดียว
            ยังไม่ใช่ต้นฉบับใบเสร็จและไม่สามารถสั่งพิมพ์หรือออกเอกสารใหม่จาก Session บัญชี
          </div>
          <FinanceSalesDashboard actor="accountant" initialTab="sales" />
        </>
      ) : null}

      {dataError ? <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{dataError}</div> : null}

      {productSales ? (
        <section className={panel + " overflow-hidden"}>
          <div className="border-b bg-slate-50 px-4 py-3 text-sm font-bold">
            สรุปรายการขายสินค้า 7 วัน ({productSales.from} ถึง {productSales.to}) · {productSales.orders} บิลสำเร็จ
          </div>
          <p className="px-4 py-2 text-xs text-slate-500">
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
        <section className={panel + " overflow-hidden"}>
          <div className="border-b bg-slate-50 px-4 py-3 text-sm font-bold">
            สินค้าที่เปิดใช้งาน ({products.length} รายการ) · แสดงเพื่อการตรวจสอบ
          </div>
          <p className="px-4 py-2 text-xs text-slate-500">
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
        <section className={panel + " p-4"}>
          <h2 className="text-sm font-bold">ข้อมูลร้านค้า (อ่านอย่างเดียว)</h2>
          <p className="mt-2 text-base font-bold">{store.name}</p>
          <p className="mt-1 text-xs text-slate-600">สถานะร้าน: {store.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</p>
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
          <p className="mt-3 text-xs text-slate-500">การแก้ไขที่อยู่บริษัท การเพิ่มสาขา และการกำหนดเครื่องยังต้องผ่านขั้นตอนอนุมัติและสิทธิ์ที่เหมาะสม</p>
        </section>
      ) : null}

      {taxView ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          เมนูออกใบกำกับภาษียังไม่เปิดการออกเอกสารใน Session ฝ่ายบัญชี
          จนกว่าจะตรวจเลขประจำตัวผู้เสียภาษี สถานะ VAT และลำดับเลขเอกสาร รวมถึง Audit Log ได้ครบ
          สามารถเปิดรายการขายสำเร็จในเมนูใบเสร็จย้อนหลังเพื่อใช้ตรวจสอบข้อมูลประกอบได้
        </div>
      ) : null}

      {group === "settings" && !storeView ? (
        <section className={panel + " p-4"}>
          <h2 className="text-sm font-bold">การตั้งค่า {item.label}</h2>
          <p className="mt-2 text-sm text-slate-600">
            เปิดหน้าเมนูและสิทธิ์เรียบร้อยแล้ว แต่ยังไม่อนุญาตให้ Session บัญชีเปลี่ยนการตั้งค่าจริง
            เพื่อป้องกันการแก้ไขสิทธิ์สาขา เครื่องรับชำระ และข้อมูลภาษีโดยไม่มีขั้นตอนยืนยัน
          </p>
          <p className="mt-3 text-xs text-slate-500">เลือกหมวดที่เกี่ยวข้องด้านล่างได้ โดยแต่ละหน้าตรวจสอบสิทธิ์กับนโยบาย IT แยกกัน</p>
        </section>
      ) : null}

      <section className={panel + " p-4"}>
        <h2 className="text-sm font-bold">เมนูที่เกี่ยวข้อง</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/finance" className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-100">
            กลับไปการเงิน
          </Link>
          {related.filter(entry => entry.slug !== slug).map(entry => (
            <Link key={entry.key} href={`/finance/${entry.group}/${entry.slug}`}
              className="rounded border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100">
              {entry.label}
            </Link>
          ))}
        </div>
      </section>
    </section>
  );
}
