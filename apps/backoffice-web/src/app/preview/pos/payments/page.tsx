import Image from "next/image";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function PosPaymentsPage() {
  await requirePosPagePermission("sale:create", "/login/store");
  const lang = await getCurrentLanguage();
  const th = lang === "th";

  return (
    <section className="flex h-full w-full items-center justify-center overflow-auto bg-slate-50 p-4 sm:p-6">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-xl sm:p-8">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="6" width="18" height="12" rx="2" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <path d="M7 15h3" />
            <path d="M15 15h2" />
          </svg>
        </div>
        <h1 className="mt-4 text-2xl font-black text-slate-950 sm:text-3xl">
          {th ? "ระบบชำระเงิน" : "Payment"}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-base font-semibold leading-7 text-slate-700">
          {th
            ? "อยู่ระหว่างปรับปรุงระบบ โปรดติดต่อช่องทางไลน์ หรือ โทร 0985460355"
            : "This payment area is under maintenance. Please contact us via LINE or call 0985460355."}
        </p>
        <div className="mx-auto mt-6 w-full max-w-[260px] rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <Image src="/brand/line-company-qr.png" alt={th ? "QR LINE บริษัท" : "Company LINE QR code"} width={360} height={360} priority className="h-auto w-full rounded-xl" />
        </div>
        <a href="tel:0985460355" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-[0_12px_26px_rgba(37,99,235,0.25)] transition hover:bg-blue-700">
          0985460355
        </a>
      </div>
    </section>
  );
}