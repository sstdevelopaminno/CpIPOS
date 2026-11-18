import Link from "next/link";
import { notFound } from "next/navigation";
import { FinanceSalesDashboard } from "@/components/finance/finance-sales-dashboard";
import { FinanceAccountingRegister } from "@/components/finance/finance-accounting-register";
import { FinanceDocumentWorkspace } from "@/components/finance/finance-document-workspace";
import { FinanceSectionHeader } from "@/app/finance/finance-section-header";
import { accountantFinanceModule } from "@/lib/accountant-menu-policy";
import { requireAccountantPage } from "@/lib/server/accountant-page-guard";

export const dynamic = "force-dynamic";

type Stage = { title: string; detail: string; ready?: boolean };
const stages: Record<string, Stage[]> = {
  expenses: [
    { title: "บันทึกรายจ่ายและค่าใช้จ่าย", detail: "ทะเบียนรายจ่ายพร้อมเอกสารอ้างอิง สาขา ผู้รับเงิน และหมวดบัญชี" },
    { title: "อนุมัติการจ่าย", detail: "แยกผู้บันทึก ผู้อนุมัติ และผู้จ่ายเงินจริง; ไม่สร้างรายการจ่ายจากยอดขาย POS" },
    { title: "เชื่อมบัญชีแยกประเภท", detail: "หลังตรวจสอบหลักฐานเท่านั้น จึงลงเดบิตและเครดิตแบบไม่ซ้ำ" }
  ],
  "sales-receivables": [
    { title: "ใบเสนอราคา → ใบสั่งขาย → ใบส่งของ", detail: "เตรียมลำดับเอกสารและเลขอ้างอิงเพื่อไม่ให้สร้างยอดขายซ้ำ" },
    { title: "ใบแจ้งหนี้และติดตามลูกหนี้", detail: "เตรียมวันครบกำหนด ยอดรับชำระคงเหลือ และรายงานอายุลูกหนี้" },
    { title: "ใบเสร็จรับเงินจาก POS", detail: "เปิดดูบิลที่ชำระสำเร็จ ออกสำเนาและแก้ไขเอกสารแบบมีประวัติ", ready: true },
    { title: "ใบกำกับภาษี", detail: "เอกสารที่ออกจากยอดภาษีจริงและข้อมูล VAT ผ่านการยืนยันแล้ว อยู่ในภาษีและรายงาน", ready: true }
  ],
  "purchases-payables": [
    { title: "ใบขอซื้อ → ใบสั่งซื้อ", detail: "แยกการขอซื้อ การอนุมัติ และผู้จำหน่ายก่อนสั่งซื้อ" },
    { title: "บันทึกรับสินค้า", detail: "จับคู่เอกสารรับกับใบสั่งซื้อและการเคลื่อนไหวสต๊อกโดยไม่ซ้ำ" },
    { title: "ค่าใช้จ่ายและใบสำคัญจ่าย", detail: "รองรับเอกสารประกอบและสถานะการอนุมัติจ่าย" },
    { title: "รายงานอายุเจ้าหนี้", detail: "คำนวณจากยอดคงค้างและวันครบกำหนดของเอกสารที่ผ่านการบันทึก" }
  ],
  banking: [
    { title: "ตรวจสอบยอดรับจาก POS", detail: "ตรวจความต่างระหว่างยอดบิลและรายการชำระที่ระบบ POS บันทึก", ready: true },
    { title: "เงินสดย่อย การโอน และเช็ครับ-เช็คจ่าย", detail: "ต้องมีทะเบียนบัญชีการเงินและหลักฐานรายการก่อนเริ่มบันทึกจริง" },
    { title: "Bank Reconciliation", detail: "ต้องนำ Statement และรายการบัญชีธนาคารมาเทียบแยก ไม่ใช่ใช้รายงานตรวจสอบยอด POS แทน" }
  ],
  ledger: [
    { title: "ผังบัญชีและสมุดรายวัน", detail: "กำหนดเลขบัญชี ประเภทบัญชี งวด และคู่เดบิต/เครดิตที่ต้องสมดุล" },
    { title: "ลงบัญชีจาก POS / ลูกหนี้ / เจ้าหนี้", detail: "โพสต์จากเอกสารที่ผ่านอนุมัติแบบ idempotent ห้ามลงซ้ำจากใบเสร็จและยอดขาย" },
    { title: "ปรับปรุงและปิดงวด", detail: "ต้องมีวันปิดงวด ข้อกำหนดกลับรายการ และ Audit Trail" },
    { title: "งบทดลอง งบกำไรขาดทุน งบแสดงฐานะการเงิน", detail: "สร้างจากสมุดรายวันที่โพสต์จริงเท่านั้น ไม่ประมาณตัวเลขจาก POS" }
  ],
  "tax-reports": [
    { title: "ใบกำกับภาษีจาก POS", detail: "ดูและพิมพ์สำเนาใบกำกับภาษีที่ออกจริงโดยตรวจสอบสถานะ VAT", ready: true },
    { title: "รายงานภาษีซื้อ / ภาษีขาย (ภ.พ.30)", detail: "ต้องเชื่อมเอกสารภาษีต้นทางและวันภาษีก่อนคำนวณสำหรับยื่นจริง" },
    { title: "หนังสือรับรองหัก ณ ที่จ่าย (ภ.ง.ด.3 / 53)", detail: "ต้องเก็บผู้รับเงิน ประเภทเงินได้ อัตราและรายการหักภาษีจริงก่อนออกหนังสือ" }
  ]
};
const intros: Record<string, string> = {
  income: "รายรับที่ตรวจสอบได้จากบิล POS ที่ชำระสำเร็จ แสดงตามสาขา สกุลเงิน และช่องทางชำระ",
  expenses: "ศูนย์จัดการรายจ่ายและหลักฐานการจ่ายเงิน แยกจากรายรับ POS อย่างชัดเจน",
  "sales-receivables": "จัดลำดับเอกสารขาย ติดตามลูกหนี้ และดูใบเสร็จจากยอดขายจริง",
  "purchases-payables": "การจัดซื้อ รับสินค้า จ่ายเงินซัพพลายเออร์ และติดตามหนี้คงค้าง",
  banking: "ตรวจรายการรับชำระของ POS ก่อนเชื่อมทะเบียนธนาคารและ Statement จริง",
  ledger: "ศูนย์กลางผังบัญชี สมุดรายวัน และงบการเงินที่ต้องอ้างอิงรายการโพสต์จริง",
  "tax-reports": "จัดการใบกำกับภาษีที่ออกจริง และเตรียมการรวบรวมรายงานภาษีตามเอกสารอ้างอิง"
};

function WorkflowPanel({ entries }: { entries: Stage[] }) {
  return (
    <section className="w-full border-b border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-[#f3f6fa] px-5 py-3">
        <h2 className="text-sm font-bold text-[#173d66]">ลำดับงานและการเชื่อมเอกสาร</h2>
      </div>
      <div className="grid gap-px bg-slate-200 md:grid-cols-2">
        {entries.map((entry, index) => (
          <div key={entry.title} className="min-w-0 bg-white px-5 py-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-[#e9f1fc] text-xs font-bold text-[#1a5b9c]">{index + 1}</span>
              <h3 className="text-sm font-bold leading-6 text-slate-800">{entry.title}</h3>
              <span className={"rounded px-2 py-0.5 text-[11px] font-semibold " +
                (entry.ready ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600")}>
                {entry.ready ? "เชื่อมบริการเดิม" : "ยังไม่เปิดบันทึกจริง"}
              </span>
            </div>
            <p className="mt-2 pl-9 text-xs leading-6 text-slate-600">{entry.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function FinanceModulePage({ params }: {
  params: Promise<{ module: string }>
}) {
  const { module: slug } = await params;
  const item = accountantFinanceModule(slug);
  if (!item) notFound();
  const identity = await requireAccountantPage(item.key);
  return (
    <section className="finance-secondary-workbench w-full min-w-0 bg-white text-slate-900">
      <FinanceSectionHeader title={item.label}
        subtitle={intros[slug] + ` · ${identity.branchIds.length} สาขาที่ได้รับสิทธิ์`} />
      {slug === "income" && (
        <div>
          <div className="border-b border-blue-100 bg-blue-50 px-5 py-3 text-xs leading-6 text-blue-900">
            รายรับส่วนนี้เป็นยอดชำระจาก POS ไม่ใช่บัญชีรายได้ที่โพสต์เดบิต/เครดิตแล้ว และไม่รวมยอดลูกหนี้ที่ยังไม่ได้รับเงินจริง
          </div>
          <FinanceSalesDashboard actor="accountant" initialTab="sales" />
        </div>
      )}
      {stages[slug] && <WorkflowPanel entries={stages[slug]} />}
      {(slug === "expenses" || slug === "sales-receivables" || slug === "purchases-payables" || slug === "ledger") && (
        <FinanceAccountingRegister module={slug} />
      )}
      {slug === "sales-receivables" && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-blue-50 px-5 py-3 text-xs leading-6">
            <b className="text-blue-950">ทะเบียนใบเสร็จย้อนหลังจาก POS</b>
            <Link href="/finance/tax-reports" className="font-bold text-blue-800 underline-offset-2 hover:underline">ไปยังใบกำกับภาษี</Link>
          </div>
          <FinanceDocumentWorkspace kind="receipt" />
        </div>
      )}
      {slug === "banking" && (
        <div>
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs leading-6 text-amber-950">
            ส่วนด้านล่างตรวจสอบความตรงกันของบิล POS กับ Payment เท่านั้น ยังไม่ใช่การกระทบยอดกับ Bank Statement
          </div>
          <FinanceSalesDashboard actor="accountant" initialTab="reconcile" />
        </div>
      )}
      {slug === "tax-reports" && (
        <div>
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-xs leading-6 text-amber-950">
            แสดงเอกสารภาษีจาก POS ตามสิทธิ์และข้อมูล VAT ที่ยืนยันแล้วเท่านั้น ไม่ถือเป็นแบบ ภ.พ.30 หรือ ภ.ง.ด.3/53 พร้อมยื่น
          </div>
          <FinanceDocumentWorkspace kind="tax" />
        </div>
      )}
      {(slug === "expenses" || slug === "purchases-payables" || slug === "ledger") && (
        <div className="border-b border-slate-200 bg-white px-5 py-6 text-sm leading-7 text-slate-600">
          ทะเบียนเอกสารและบัญชีจะเปิดบันทึกจริงได้หลังผ่านการตรวจสอบฐานข้อมูล สิทธิ์อนุมัติ และเปิดใช้ฟีเจอร์ฝั่งเซิร์ฟเวอร์แล้วเท่านั้น
        </div>
      )}
    </section>
  );
}
