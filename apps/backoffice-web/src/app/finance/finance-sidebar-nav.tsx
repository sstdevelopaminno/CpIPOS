"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { AccountantNavItem } from "@/lib/accountant-menu-policy";
import { FinanceNavIcon, type FinanceNavIconName } from "./finance-nav-icon";

type SidebarProps = {
  showFinance: boolean;
  showMore: boolean;
  showSettings: boolean;
  showPackagePayment: boolean;
  moreItems: readonly AccountantNavItem[];
  settingsItems: readonly AccountantNavItem[];
};

const moreIcons: Record<string, FinanceNavIconName> = {
  "sales-summary": "sales",
  receipts: "receipt",
  "tax-invoices": "tax",
  stock: "products",
  "product-sales": "list"
};

const settingsIcons: Record<string, FinanceNavIconName> = {
  branding: "palette",
  store: "store",
  branches: "branches",
  devices: "devices",
  printers: "printer",
  activity: "activity",
  payments: "payments",
  "inet-nops": "qr",
  taxes: "tax",
  notifications: "notifications",
  support: "support",
  "push-notifications": "notifications",
  language: "language",
  currency: "payments",
  placement: "layout",
  display: "display",
  "order-kitchen": "notifications",
  "table-qr": "qr"
};

const baseLink =
  "group flex min-h-10 items-center gap-3 rounded-lg border px-3 py-2.5 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300";

function activeLink(active: boolean): string {
  return active
    ? baseLink + " border-sky-400/50 bg-[#1761a0] text-white shadow-[inset_3px_0_0_#67e8f9]"
    : baseLink + " border-transparent text-slate-200 hover:border-white/10 hover:bg-white/10 hover:text-white";
}

export function FinanceSidebarNav({
  showFinance, showMore, showSettings, showPackagePayment,
  moreItems, settingsItems
}: SidebarProps) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(() => pathname.startsWith("/finance/settings"));

  useEffect(() => {
    if (pathname.startsWith("/finance/settings")) setSettingsOpen(true);
    if (pathname.startsWith("/finance/more")) setMoreOpen(true);
  }, [pathname]);

  return (
    <nav aria-label="เมนูฝ่ายบัญชี" className="space-y-2.5 px-3 py-3">
      <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
        เมนูหลัก
      </p>
      {showFinance ? (
        <Link href="/finance" aria-current={pathname === "/finance" ? "page" : undefined}
          className={activeLink(pathname === "/finance")}>
          <FinanceNavIcon name="finance" />
          <span className="min-w-0 flex-1">การเงิน</span>
        </Link>
      ) : null}

      {showMore ? (
        <section className="rounded-xl border border-white/10 bg-white/[0.045] p-1.5">
          <button type="button" aria-expanded={moreOpen} aria-controls="finance-more-menu"
            onClick={() => setMoreOpen(open => !open)}
            className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] font-bold text-slate-100 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">
            <FinanceNavIcon name="more" />
            <span className="min-w-0 flex-1">เพิ่มเติม</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={"h-4 w-4 shrink-0 transition-transform " + (moreOpen ? "rotate-180" : "")}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {moreOpen ? (
            <div id="finance-more-menu" className="mt-1 space-y-0.5 border-l border-sky-300/25 pl-1.5">
              {moreItems.map(item => {
                const href = "/finance/more/" + item.slug;
                return (
                  <Link href={href} key={item.key} aria-current={pathname === href ? "page" : undefined}
                    className={activeLink(pathname === href)}>
                    <FinanceNavIcon name={moreIcons[item.slug] ?? "list"} className="h-[16px] w-[16px]" />
                    <span className="min-w-0 flex-1 leading-5">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {showSettings ? (
        <section className="rounded-xl border border-white/10 bg-white/[0.045] p-1.5">
          <button type="button" aria-expanded={settingsOpen} aria-controls="finance-settings-menu"
            onClick={() => setSettingsOpen(open => !open)}
            className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px] font-bold text-slate-100 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">
            <FinanceNavIcon name="settings" />
            <span className="min-w-0 flex-1">ตั้งค่า</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={"h-4 w-4 shrink-0 transition-transform " + (settingsOpen ? "rotate-180" : "")}>
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          {settingsOpen ? (
            <div id="finance-settings-menu" className="mt-1 space-y-0.5 border-l border-sky-300/25 pl-1.5">
              {settingsItems.map(item => {
                const href = "/finance/settings/" + item.slug;
                return (
                  <Link href={href} key={item.key} aria-current={pathname === href ? "page" : undefined}
                    className={activeLink(pathname === href)}>
                    <FinanceNavIcon name={settingsIcons[item.slug] ?? "settings"} className="h-[16px] w-[16px]" />
                    <span className="min-w-0 flex-1 leading-5">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {showPackagePayment ? (
        <Link href="/finance/package-payment" aria-current={pathname === "/finance/package-payment" ? "page" : undefined}
          className={activeLink(pathname === "/finance/package-payment")}>
          <FinanceNavIcon name="package" />
          <span className="min-w-0 flex-1">ชำระแพ็กเกจ</span>
        </Link>
      ) : null}
    </nav>
  );
}
