"use client";

import Image from "next/image";
import Link from "next/link";
import { PosSupportChat } from "@/components/pos-preview/pos-support-chat";

function SupportIcon({ kind }: { kind: "line" | "chat" | "phone" | "mail" }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "phone") return <svg {...common}><path d="M7 3H4l-1 5c1 6 7 12 13 13l5-1v-3l-5-3-3 3a16 16 0 0 1-6-6l3-3-3-5Z" /></svg>;
  if (kind === "mail") return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 7 9-7" /></svg>;
  if (kind === "chat") return <svg {...common}><path d="M4 14v-2a8 8 0 1 1 16 0v2" /><path d="M4 13H2v5h5v-5H4Zm16 0h2v5h-5v-5h3Z" /><path d="M20 18c0 3-3 4-8 4" /></svg>;
  return <svg {...common}><path d="M7 6h10a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-4l-4 3v-3H7a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4Z" /></svg>;
}

export function PosSupportCenter({ storeCode, storeName, supportEmail }: { storeCode: string; storeName: string; supportEmail: string }) {
  return <section className="h-full w-full overflow-y-auto bg-[#f7faff] px-4 pb-10 pt-6 sm:px-6 xl:px-8">
    <div className="mx-auto max-w-[1180px] space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-black tracking-tight text-[#10213d] sm:text-[29px]">ติดต่อสอบถาม / แจ้งปัญหา</h1>
          <p className="mt-1 text-sm text-[#687992]">เลือกช่องทางติดต่อบริษัทหรือเปิดการสนทนากับฝ่าย IT Support</p>
        </div>
        <Link href="/preview/pos/payments" className="inline-flex items-center gap-2 rounded-xl border border-[#d9e4f7] bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50">
          <span aria-hidden>←</span>กลับศูนย์ช่วยเหลือ
        </Link>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-3xl border border-emerald-100 bg-white p-5 shadow-[0_8px_28px_rgba(23,50,95,0.06)] sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 font-black text-emerald-600">LINE</span>
            <div><h2 className="text-lg font-black text-[#10213d]">LINE · QR ติดต่อบริษัท</h2>
              <p className="text-xs leading-5 text-slate-500">สำหรับสอบถามข้อมูลและติดต่อบริษัท ไม่ใช่ QR ชำระเงิน</p></div>
          </div>
          <div className="mt-5 rounded-2xl bg-[#f8fffb] p-4 text-center">
            <Image src="/brand/line-company-qr.png" width={440} height={440} priority
              alt="QR LINE ติดต่อบริษัท ไม่ใช่ QR ชำระเงิน"
              className="mx-auto h-auto w-full max-w-[260px] rounded-2xl border border-emerald-100 bg-white p-2" />
            <p className="mt-3 text-xs font-semibold text-emerald-700">สแกน QR เพื่อเพิ่ม LINE และติดต่อทีมบริษัท</p>
          </div>
        </section>

        <section className="rounded-3xl border border-violet-100 bg-white p-5 shadow-[0_8px_28px_rgba(23,50,95,0.06)] sm:p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-50 text-violet-600"><SupportIcon kind="chat" /></span>
            <div><h2 className="text-lg font-black text-[#10213d]">แจ้งปัญหา</h2>
              <p className="text-xs leading-5 text-slate-500">เชื่อมต่อระบบ Support Chat เดิม พร้อมส่งข้อความถึงฝ่าย IT</p></div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <a href="tel:0985460355" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-50 px-3 py-3 text-sm font-bold text-blue-700">
              <SupportIcon kind="phone" />โทร. 0985460355
            </a>
            <a href={"mailto:" + supportEmail} className="flex min-h-12 items-center justify-center gap-2 break-all rounded-xl bg-blue-50 px-3 py-3 text-xs font-bold text-blue-700">
              <SupportIcon kind="mail" />{supportEmail}
            </a>
          </div>
          <div className="mt-4">
            <PosSupportChat storeCode={storeCode} storeName={storeName} />
          </div>
        </section>
      </div>
    </div>
  </section>;
}
