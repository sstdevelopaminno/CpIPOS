import Image from "next/image";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { getCurrentLanguage } from "@/lib/i18n";
import { loadPosPackageOverview } from "@/lib/services/pos-package-overview-service";

function displayLimit(value: number | null, unlimitedLabel: string) {
  return value === null ? unlimitedLabel : String(value);
}

export default async function PosPaymentsPage() {
  const scope = await requirePosPagePermission("sale:create", "/login/store");
  const lang = await getCurrentLanguage();
  const th = lang === "th";
  const overview = await loadPosPackageOverview(scope.session.tenant_id);
  const amountFormatter = new Intl.NumberFormat(th ? "th-TH" : "en-US", { style: "currency", currency: overview.currency });
  const price = overview.amountPerCycle === null ? "-" : amountFormatter.format(overview.amountPerCycle);

  const copy = th
    ? {
        title: "ระบบชำระเงิน",
        subtitle: "อยู่ระหว่างปรับปรุงระบบ โปรดติดต่อช่องทางไลน์ หรือ โทร 0985460355",
        currentPackage: "แพ็กเกจปัจจุบัน",
        storeCode: "รหัสร้าน",
        storeName: "ชื่อร้าน",
        status: "สถานะ",
        quota: "โควตา",
        branches: "สาขา",
        cashiers: "เครื่องแคชเชียร์/สาขา",
        users: "ผู้ใช้งาน",
        unlimited: "ไม่จำกัด",
        unset: "ยังไม่ระบุ",
        price: "ราคา",
        lineQr: "QR LINE บริษัท",
        call: "โทร 0985460355"
      }
    : {
        title: "Payment",
        subtitle: "This payment area is under maintenance. Please contact us via LINE or call 0985460355.",
        currentPackage: "Current package",
        storeCode: "Store code",
        storeName: "Store name",
        status: "Status",
        quota: "Quota",
        branches: "Branches",
        cashiers: "Cashier machines/branch",
        users: "Users",
        unlimited: "Unlimited",
        unset: "Not set",
        price: "Price",
        lineQr: "Company LINE QR",
        call: "Call 0985460355"
      };
  const quotaText = copy.branches + ": " + displayLimit(overview.maxBranches, copy.unlimited) + " | " + copy.cashiers + ": " + displayLimit(overview.maxDevices, copy.unlimited) + " | " + copy.users + ": " + displayLimit(overview.maxUsers, copy.unlimited);

  return (
    <section className="flex h-full w-full items-start justify-center overflow-auto bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="grid w-full max-w-5xl gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl lg:grid-cols-[1fr_280px] lg:p-7">
        <div className="min-w-0">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="6" width="18" height="12" rx="2" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <path d="M7 15h3" />
              <path d="M15 15h2" />
            </svg>
          </div>
          <h1 className="mt-4 text-2xl font-black text-slate-950 sm:text-3xl">{copy.title}</h1>
          <p className="mt-3 max-w-2xl text-sm font-semibold leading-7 text-slate-700 sm:text-base">{copy.subtitle}</p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <InfoTile label={copy.storeCode} value={overview.storeCode} />
            <InfoTile label={copy.storeName} value={overview.storeName} />
            <InfoTile label={copy.currentPackage} value={overview.packageName ?? copy.unset} hint={overview.packageCode ?? undefined} />
            <InfoTile label={copy.status} value={overview.contractStatus ?? copy.unset} />
            <InfoTile label={copy.price} value={price} hint={overview.billingInterval ?? undefined} />
            <InfoTile label={copy.quota} value={quotaText} />
          </div>
        </div>

        <aside className="grid content-start justify-items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-center">
          <p className="text-sm font-black text-slate-900">{copy.lineQr}</p>
          <div className="w-full max-w-[230px] rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <Image src="/brand/line-company-qr.png" alt={copy.lineQr} width={360} height={360} priority className="h-auto w-full rounded-xl" />
          </div>
          <a href="tel:0985460355" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-bold text-white shadow-[0_12px_26px_rgba(37,99,235,0.25)] transition hover:bg-blue-700">
            {copy.call}
          </a>
        </aside>
      </div>
    </section>
  );
}

function InfoTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 break-words text-base font-black text-slate-950">{value}</p>
      {hint ? <p className="mt-1 break-words text-xs font-semibold text-slate-500">{hint}</p> : null}
    </div>
  );
}
