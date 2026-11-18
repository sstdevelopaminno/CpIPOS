import { notFound } from "next/navigation";
import { FinanceSectionHeader } from "@/app/finance/finance-section-header";
import { accountantMenuItem } from "@/lib/accountant-menu-policy";
import { requireAccountantPage } from "@/lib/server/accountant-page-guard";
import { loadAccountantStoreOverview } from "@/lib/server/finance-accountant-readonly-services";

export const dynamic = "force-dynamic";
const cell = "border-b border-slate-100 px-4 py-3 text-left text-xs leading-5";
export default async function AccountantSettingsPage({ params }: {
  params: Promise<{ group: string; slug: string }>
}) {
  const { group, slug } = await params;
  // Old /finance/more/* URLs are intentionally retired, including the product master route.
  const item = accountantMenuItem(group, slug);
  if (!item) notFound();
  const identity = await requireAccountantPage(item.key);
  const storeView = slug === "store";
  let store: Awaited<ReturnType<typeof loadAccountantStoreOverview>> | null = null;
  let dataError: string | null = null;
  try { if (storeView) store = await loadAccountantStoreOverview(identity); }
  catch { dataError = "ยังโหลดข้อมูลร้านค้าจาก POS ไม่สำเร็จ กรุณาลองอีกครั้งหรือติดต่อฝ่าย IT"; }
  return (
    <section className="finance-secondary-workbench w-full min-w-0 bg-white text-slate-900">
      <FinanceSectionHeader title={item.label} group="settings"
        subtitle={`ฝ่ายบัญชี · ${identity.branchIds.length} สาขาที่ได้รับสิทธิ์`} />
      <div className="w-full min-w-0 divide-y divide-slate-200 bg-white">
        {dataError && <div role="alert" className="mx-5 my-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm">{dataError}</div>}
        {store && (
          <section className="border-b border-slate-200 bg-white px-5 py-5">
            <h2 className="text-sm font-bold">ข้อมูลร้านค้า (อ่านอย่างเดียว)</h2>
            <p className="mt-2 text-base font-bold">{store.name}</p>
            <p className="mt-1 text-xs text-slate-600">สถานะร้าน: {store.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-xs">
                <thead className="bg-[#e8f0fa]"><tr><th className={cell}>รหัสสาขา</th><th className={cell}>ชื่อสาขา</th><th className={cell}>สถานะ</th></tr></thead>
                <tbody>{store.branches.map(branch => <tr key={branch.id}><td className={cell}>{branch.code}</td>
                  <td className={cell}>{branch.name}</td><td className={cell}>{branch.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        )}
        {!storeView && (
          <section className="border-b border-slate-200 px-5 py-5">
            <h2 className="text-sm font-bold">การตั้งค่า {item.label}</h2>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              ฝ่ายบัญชีสามารถตรวจดูหมวดที่ได้รับสิทธิ์ แต่ยังไม่มีสิทธิ์เปลี่ยนการตั้งค่าจริง
              ต้องผ่านผู้อนุมัติสำหรับเครื่องรับชำระ ภาษี ข้อมูลสาขา และข้อมูลทางการเงิน
            </p>
          </section>
        )}
      </div>
    </section>
  );
}
