import Link from "next/link";
import { notFound } from "next/navigation";
import { accountantMenuItem } from "@/lib/accountant-menu-policy";
import { requireAccountantPage } from "@/lib/server/accountant-page-guard";

export const dynamic = "force-dynamic";

export default async function AccountantFeaturePage({ params }: {
  params: Promise<{ group: string; slug: string }>
}) {
  const { group, slug } = await params;
  const item = accountantMenuItem(group, slug);
  if (!item) notFound();
  const identity = await requireAccountantPage(item.key);
  return (
    <article className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-blue-700">
        {group === "more" ? "เพิ่มเติม" : "ตั้งค่า"} · CpiPOS Finance
      </p>
      <h1 className="mt-2 text-2xl font-extrabold">{item.label}</h1>
      <p className="mt-2 text-slate-600">ฝ่ายบัญชี · ขอบเขตร้านเดียวกัน {identity.branchIds.length} สาขาที่เปิดใช้งาน</p>
      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
        เมนูนี้ได้รับสิทธิ์ให้แสดงแล้ว แต่ยังไม่เปิดการอ่านหรือแก้ไขข้อมูล POS จริงสำหรับ Session ฝ่ายบัญชี
        จนกว่าจะเชื่อม API ที่ตรวจสอบข้อมูลทุกสาขาและบันทึก Audit Log ครบถ้วน
      </div>
      <Link href="/finance" className="mt-6 inline-block text-sm font-semibold text-blue-700 underline">กลับไปการเงิน</Link>
    </article>
  );
}
