import {RecyclingFinanceExpenseWorkspace} from "@/components/finance/recycling-finance-expense-workspace";
import {RecyclingFinanceIncomeWorkspace} from "@/components/finance/recycling-finance-income-workspace";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { RecyclingFinanceVatWorkspace } from "@/components/finance/recycling-finance-vat-workspace";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { notFound } from "next/navigation";
import { FinanceAccountingRegister } from "@/components/finance/finance-accounting-register";
import { FinanceIncomeWorkspace } from "@/components/finance/finance-income-workspace";
import { FinanceBankingWorkspace } from "@/components/finance/finance-banking-workspace";
import { FinanceDocumentWorkspace } from "@/components/finance/finance-document-workspace";
import { FinancePostedJournals } from "@/components/finance/finance-posted-journals";
import { FinanceSectionHeader } from "@/app/finance/finance-section-header";
import { accountantFinanceModule } from "@/lib/accountant-menu-policy";
import { requireAccountantPage } from "@/lib/server/accountant-page-guard";

export const dynamic = "force-dynamic";

const subtitles: Record<string, string> = {
  income: "รายรับจาก POS และทะเบียนรายรับอื่น ๆ พร้อมเลขเอกสารแยกกัน",
  expenses: "ทะเบียนรายจ่าย ค่าใช้จ่าย และเอกสารประกอบการขออนุมัติ",
  "sales-receivables": "ทะเบียนเอกสารขาย ใบแจ้งหนี้ และติดตามลูกหนี้",
  "pos-receipts": "ค้นหาบิลที่ชำระสำเร็จจาก POS และเรียกดูรายละเอียดเอกสารย้อนหลัง",
  "purchases-payables": "ทะเบียนจัดซื้อ รับสินค้า ใบแจ้งหนี้ผู้ขาย และติดตามเจ้าหนี้",
  banking: "บันทึกการโอนพร้อมหลักฐาน และตรวจสอบยอดรับที่ POS บันทึก",
  ledger: "ผังบัญชีและการจัดหมวดบัญชีที่ใช้ลงรายการจากเอกสารที่ผ่านอนุมัติ",
  "posted-journals": "ตรวจรายการเดบิต–เครดิตที่โพสต์แล้วจากฐานข้อมูล แยกตามสาขา",
  "tax-reports": "ตรวจสอบใบกำกับภาษีที่ออกจริงจาก POS และข้อมูลภาษีต้นทาง"
};

export default async function FinanceModulePage({ params }: {
  params: Promise<{ module: string }>
}) {
  const { module: slug } = await params;
  const item = accountantFinanceModule(slug);
  if (!item) notFound();
  const identity = await requireAccountantPage(item.key);
  const recyclingIncome=slug==="income"&&await isAuthorizedRecyclingTenant(identity.tenantId);
  const recyclingExpenses=slug==="expenses"&&await isAuthorizedRecyclingTenant(identity.tenantId);
  const recyclingTax=slug==="tax-reports"&&await isAuthorizedRecyclingTenant(identity.tenantId);
  const recyclingBranches=recyclingTax?await getSupabaseServiceClient().from("branches").select("id,name").eq("tenant_id",identity.tenantId).in("id",identity.branchIds).order("name"):null;
  return (
    <section className="finance-secondary-workbench w-full min-w-0 bg-white text-slate-900">
      <FinanceSectionHeader title={item.label}
        subtitle={(recyclingIncome?"ทะเบียนรายรับจากการขายส่ง และรายรับอื่น ๆ":recyclingExpenses?"ทะเบียนรับซื้อจาก POS และรายจ่ายอื่น ๆ พร้อมใบสำคัญจ่าย":subtitles[slug]) + ` · ${identity.branchIds.length} สาขาที่ได้รับสิทธิ์`} />

      {slug === "income" && (recyclingIncome?<RecyclingFinanceIncomeWorkspace/>:<FinanceIncomeWorkspace />)}
      {slug === "expenses" && (recyclingExpenses?<RecyclingFinanceExpenseWorkspace/>:<FinanceAccountingRegister module="expenses" />)}

      {slug === "sales-receivables" && <FinanceAccountingRegister module="sales-receivables" />}
      {slug === "pos-receipts" && <FinanceDocumentWorkspace kind="receipt" />}

      {slug === "purchases-payables" && <FinanceAccountingRegister module="purchases-payables" />}
      {slug === "banking" && <FinanceBankingWorkspace />}
      {slug === "ledger" && <FinanceAccountingRegister module="ledger" />}
      {slug === "posted-journals" && <FinancePostedJournals />}

      {slug === "tax-reports" && (
        <>
          <div className="border-b border-slate-200 bg-[#f6f9fc] px-5 py-3">
            <h2 className="text-sm font-bold text-[#234c78]">ทะเบียนใบกำกับภาษีจาก POS</h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              แสดงเฉพาะเอกสารต้นทางตามสิทธิ์และสถานะ VAT ที่ตรวจสอบแล้ว
              ไม่ใช่แบบ ภ.พ.30 หรือ ภ.ง.ด.3/53 พร้อมยื่น
            </p>
          </div>
          {recyclingTax&&(recyclingBranches?.error?<p role="alert" className="p-4 text-amber-900">ยังโหลดสาขาสำหรับตั้งค่า VAT Recycling ไม่สำเร็จ</p>:<RecyclingFinanceVatWorkspace branches={(recyclingBranches?.data??[]).map(b=>({id:String(b.id),name:String(b.name)}))}/>)}
          <FinanceDocumentWorkspace kind="tax" />
        </>
      )}
    </section>
  );
}
