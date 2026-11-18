import { FinanceSectionHeader } from "@/app/finance/finance-section-header";
import Link from "next/link";
import { requireAccountantPage } from "@/lib/server/accountant-page-guard";
import { loadAccountantContractOverview } from "@/lib/server/finance-accountant-readonly-services";

export const dynamic = "force-dynamic";

export default async function AccountantPackagePaymentPage() {
  const identity = await requireAccountantPage("main.package_payment");
  let contract: Awaited<ReturnType<typeof loadAccountantContractOverview>> | null = null;
  let error = false;
  try { contract = await loadAccountantContractOverview(identity); } catch { error = true; }

  return (
    <section className="finance-secondary-workbench w-full min-w-0 bg-white text-slate-900">
      <FinanceSectionHeader title="ชำระแพ็กเกจ"
        subtitle="ตรวจสอบสถานะสัญญาแพ็กเกจของร้าน (ไม่สร้างรายการชำระใหม่)" />
      <div className="w-full min-w-0 bg-white">
      {error ? <div role="alert" className="mx-5 my-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6">
        ไม่สามารถอ่านข้อมูลสัญญาได้ กรุณาตรวจสอบกับฝ่าย IT
      </div> : (
        <section className="border-b border-slate-200 bg-white px-5 py-5">
          <h2 className="text-sm font-bold">สัญญาแพ็กเกจล่าสุด</h2>
          {contract ? (
            <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-xs text-slate-500">สถานะสัญญา</dt>
                <dd className="mt-1 text-sm font-bold">{contract.status}</dd></div>
              <div><dt className="text-xs text-slate-500">รอบสัญญา</dt>
                <dd className="mt-1 text-sm font-bold">{contract.billingCycle ?? "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">จำนวนเงินต่อรอบตามสัญญา</dt>
                <dd className="mt-1 text-sm font-bold">{contract.amountPerCycle?.toLocaleString("th-TH") ?? "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">วันสิ้นสุดตามสัญญา</dt>
                <dd className="mt-1 text-sm font-bold">{contract.endedAt ? new Date(contract.endedAt).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" }) : "—"}</dd></div>
            </dl>
          ) : <p className="mt-3 text-sm text-slate-500">ยังไม่มีข้อมูลสัญญาแพ็กเกจ</p>}
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950">
            การชำระเงินจริงต้องดำเนินการผ่านขั้นตอนที่ตรวจสอบสิทธิ์และ Settlement ก่อน
            หน้านี้ไม่ออกใบเสร็จ ไม่รับชำระ และไม่เปลี่ยนสัญญาหรือสิทธิ์ของร้าน
          </p>
        </section>
      )}
      <Link href="/finance" className="m-5 inline-block rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-xs font-semibold text-blue-800 hover:bg-blue-100">
        กลับไปการเงิน
      </Link>
      </div>
    </section>
  );
}
