import Image from "next/image";
import type { ReactNode } from "react";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { getCurrentLanguage } from "@/lib/i18n";
import { loadPosPackageOverview } from "@/lib/services/pos-package-overview-service";

function displayLimit(value: number | null, unlimitedLabel: string) {
  return value === null ? unlimitedLabel : String(value);
}

function billingHint(interval: string | null, th: boolean) {
  const normalized = String(interval ?? "").trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "monthly") return th ? "ต่อเดือน (monthly)" : "per month (monthly)";
  if (normalized === "yearly" || normalized === "annual") return th ? `ต่อปี (${normalized})` : `per year (${normalized})`;
  return interval ?? undefined;
}

export default async function PosPaymentsPage() {
  const scope = await requirePosPagePermission("sale:create", "/login/store");
  const lang = await getCurrentLanguage();
  const th = lang === "th";
  const overview = await loadPosPackageOverview(scope.session.tenant_id);
  const amountFormatter = new Intl.NumberFormat(th ? "th-TH" : "en-US", {
    style: "currency",
    currency: overview.currency
  });
  const price = overview.amountPerCycle === null ? "-" : amountFormatter.format(overview.amountPerCycle);
  const statusRaw = overview.contractStatus ?? "";
  const isActive = statusRaw.trim().toLowerCase() === "active";
  const statusValue = isActive ? "Active" : statusRaw || (th ? "ยังไม่ระบุ" : "Not set");

  const copy = th
    ? {
        title: "ระบบชำระเงิน",
        subtitle: "ดูแลและตรวจสอบข้อมูลการสมัครใช้งานระบบของร้านคุณ",
        supportPrefix: "ระบบชำระเงินอยู่ระหว่างปรับปรุง หากมีข้อสงสัยหรือพบปัญหา กรุณาติดต่อช่องทางไลน์ หรือ โทร",
        currentPackage: "แพ็กเกจปัจจุบัน",
        storeCode: "รหัสร้าน",
        storeName: "ชื่อร้าน",
        status: "สถานะ",
        active: "ใช้งานได้ปกติ",
        quota: "ใช้งาน",
        branches: "สาขา",
        cashiers: "เครื่องแคชเชียร์/สาขา",
        users: "ผู้ใช้งาน",
        unlimited: "ไม่จำกัด",
        unset: "ยังไม่ระบุ",
        price: "ราคา",
        lineQr: "QR LINE บริษัท",
        lineHelp: "สแกนเพื่อเพิ่มเพื่อน หรือสอบถามข้อมูล",
        call: "โทร. 0985460355",
        scopeTitle: "ข้อมูลแพ็กเกจและสิทธิ์การใช้งานของร้านปัจจุบัน",
        scopeDescription: "ข้อมูลบนหน้านี้แสดงตามร้านและสิทธิ์ของเซสชันที่กำลังใช้งาน"
      }
    : {
        title: "Payment",
        subtitle: "Review your store subscription and account usage information.",
        supportPrefix: "The payment area is under maintenance. If you have questions or encounter an issue, contact us via LINE or call",
        currentPackage: "Current package",
        storeCode: "Store code",
        storeName: "Store name",
        status: "Status",
        active: "Operating normally",
        quota: "Usage",
        branches: "Branches",
        cashiers: "Cashier machines/branch",
        users: "Users",
        unlimited: "Unlimited",
        unset: "Not set",
        price: "Price",
        lineQr: "Company LINE QR",
        lineHelp: "Scan to add LINE or ask for support.",
        call: "Call 0985460355",
        scopeTitle: "Current store package and access information",
        scopeDescription: "The information on this page follows the store and permissions of the active session."
      };

  const quotaText =
    copy.branches +
    ": " +
    displayLimit(overview.maxBranches, copy.unlimited) +
    " | " +
    copy.cashiers +
    ": " +
    displayLimit(overview.maxDevices, copy.unlimited) +
    " | " +
    copy.users +
    ": " +
    displayLimit(overview.maxUsers, copy.unlimited);

  return (
    <section className="flex h-full w-full items-start justify-center overflow-auto bg-slate-50 px-3 py-4 sm:px-5 sm:py-6 lg:px-7 lg:py-7">
      <div className="grid w-full max-w-[1480px] gap-5 rounded-[26px] border border-slate-200/90 bg-white p-4 shadow-[0_18px_50px_rgba(15,23,42,0.10)] sm:p-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-7 lg:p-8 xl:grid-cols-[minmax(0,1fr)_430px]">
        <main className="min-w-0">
          <header className="flex items-start gap-4 sm:gap-5">
            <IconBadge tone="blue" size="large">
              <StorefrontIcon />
            </IconBadge>
            <div className="min-w-0 pt-0.5">
              <h1 className="text-[28px] font-black leading-tight tracking-[-0.02em] text-slate-950 sm:text-[34px]">{copy.title}</h1>
              <p className="mt-1.5 text-sm font-medium leading-6 text-slate-500 sm:text-base">{copy.subtitle}</p>
            </div>
          </header>

          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3.5 text-sm leading-6 text-slate-600 sm:px-5 sm:py-4 sm:text-[15px]">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-600 text-sm font-black text-white" aria-hidden>
              i
            </span>
            <p>
              {copy.supportPrefix}{" "}
              <a href="tel:0985460355" className="font-black text-blue-600 underline-offset-2 hover:underline">
                0985460355
              </a>
            </p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <InfoTile label={copy.storeCode} value={overview.storeCode} icon={<StoreCardIcon />} tone="blue" />
            <InfoTile label={copy.storeName} value={overview.storeName} icon={<UserIcon />} tone="violet" />
            <InfoTile
              label={copy.currentPackage}
              value={overview.packageName ?? copy.unset}
              hint={overview.packageCode ?? undefined}
              icon={<GrowthIcon />}
              tone="teal"
            />
            <InfoTile
              label={copy.status}
              value={statusValue}
              icon={<CheckCircleIcon />}
              tone="green"
              valueClassName={isActive ? "text-emerald-600" : undefined}
              badge={isActive ? copy.active : undefined}
            />
            <InfoTile label={copy.price} value={price} hint={billingHint(overview.billingInterval, th)} icon={<WalletIcon />} tone="orange" />
            <InfoTile label={copy.quota} value={quotaText} icon={<CalendarIcon />} tone="violet" compactValue />
          </div>

          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50/80 to-slate-50 px-4 py-4 sm:px-5">
            <IconBadge tone="blue" size="small">
              <ShieldIcon />
            </IconBadge>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800">{copy.scopeTitle}</p>
              <p className="mt-0.5 text-xs font-medium leading-5 text-slate-500 sm:text-[13px]">{copy.scopeDescription}</p>
            </div>
          </div>
        </main>

        <aside className="flex min-w-0 flex-col items-center rounded-[22px] border border-slate-200 bg-slate-50/80 p-5 text-center sm:p-6 lg:min-h-full">
          <div className="flex items-center justify-center gap-2 text-base font-black text-slate-900 sm:text-lg">
            <span className="grid h-7 min-w-7 place-items-center rounded-full bg-[#27c84a] px-1.5 text-[9px] font-black text-white" aria-hidden>
              LINE
            </span>
            <span>{copy.lineQr}</span>
          </div>
          <p className="mt-2 text-sm font-medium leading-6 text-slate-500">{copy.lineHelp}</p>

          <div className="mt-5 w-full max-w-[330px] rounded-[22px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.10)]">
            <Image src="/brand/line-company-qr.png" alt={copy.lineQr} width={480} height={480} priority className="h-auto w-full rounded-2xl" />
          </div>

          <a
            href="tel:0985460355"
            className="mt-5 inline-flex min-h-14 w-full max-w-[330px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-[15px] font-black text-white shadow-[0_12px_26px_rgba(37,99,235,0.24)] transition hover:bg-blue-700 active:translate-y-px"
          >
            <PhoneIcon />
            {copy.call}
          </a>

          <div className="mt-auto w-full pt-6">
            <div className="h-px w-full bg-slate-200" />
            <p className="mt-4 text-xs font-medium leading-5 text-slate-500">{copy.lineHelp}</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

type TileTone = "blue" | "violet" | "teal" | "green" | "orange";

const toneClasses: Record<TileTone, string> = {
  blue: "bg-blue-50 text-blue-600",
  violet: "bg-violet-50 text-violet-600",
  teal: "bg-teal-50 text-teal-600",
  green: "bg-emerald-50 text-emerald-600",
  orange: "bg-orange-50 text-orange-600"
};

function InfoTile({
  label,
  value,
  hint,
  icon,
  tone,
  badge,
  valueClassName,
  compactValue = false
}: {
  label: string;
  value: string;
  hint?: string;
  icon: ReactNode;
  tone: TileTone;
  badge?: string;
  valueClassName?: string;
  compactValue?: boolean;
}) {
  return (
    <div className="flex min-h-[112px] items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_4px_14px_rgba(15,23,42,0.04)] sm:px-5">
      <IconBadge tone={tone} size="medium">
        {icon}
      </IconBadge>
      <div className="min-w-0 flex-1 text-left">
        <p className="text-sm font-semibold text-slate-500">{label}</p>
        <p className={`mt-1 break-words font-black leading-snug ${compactValue ? "text-[15px]" : "text-xl sm:text-[22px]"} ${valueClassName ?? "text-slate-950"}`}>
          {value}
        </p>
        {hint ? <p className="mt-1 break-words text-sm font-medium text-slate-500">{hint}</p> : null}
        {badge ? (
          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-600">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
            {badge}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function IconBadge({ children, tone, size }: { children: ReactNode; tone: TileTone; size: "small" | "medium" | "large" }) {
  const sizeClass = size === "large" ? "h-14 w-14 sm:h-16 sm:w-16" : size === "medium" ? "h-12 w-12 sm:h-14 sm:w-14" : "h-11 w-11";
  return <span className={`grid shrink-0 place-items-center rounded-2xl ${sizeClass} ${toneClasses[tone]}`}>{children}</span>;
}

function StorefrontIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 9l2-5h14l2 5" />
      <path d="M5 13v7h14v-7" />
      <path d="M9 20v-5h6v5" />
      <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
    </svg>
  );
}

function StoreCardIcon() {
  return (
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="15" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 14h8" />
      <path d="M8 17h5" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21a7 7 0 0 1 14 0" />
    </svg>
  );
}

function GrowthIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 19V9" />
      <path d="M9 19v-5" />
      <path d="M14 19V7" />
      <path d="M19 19V4" />
      <path d="M4 8l5-4 5 3 5-5" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6h15a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h12" />
      <path d="M16 12h5" />
      <circle cx="17" cy="12" r=".5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 5 6v5c0 4.8 2.8 8.2 7 10 4.2-1.8 7-5.2 7-10V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.68 2.8a2 2 0 0 1-.45 2.11L8.07 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.32 1.84.55 2.8.68A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}
