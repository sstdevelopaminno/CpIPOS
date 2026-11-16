import Link from "next/link";
import { requireAccountantPage } from "@/lib/server/accountant-page-guard";

export const dynamic = "force-dynamic";

export default async function AccountantPackagePaymentPage() {
  await requireAccountantPage("main.package_payment");
  return (
    <section className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-bold tracking-wide text-blue-700">CpiPOS Finance</p>
      <h1 className="mt-2 text-2xl font-extrabold">ชำระแพ็กเกจ</h1>
      <p className="mt-3 text-slate-600">เมนูสำหรับบัญชีแสดงแล้ว ขณะนี้ยังไม่เชื่อมการชำระเงินจริงใน Session บัญชี
        เพื่อไม่ให้ใช้ Session เจ้าของร้านหรือเครื่องแคชเชียร์แทนกัน</p>
      <Link href="/finance" className="mt-6 inline-block text-sm font-semibold text-blue-700 underline">กลับไปการเงิน</Link>
    </section>
  );
}
