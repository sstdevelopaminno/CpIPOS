"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { AccountantNavItem } from "@/lib/accountant-menu-policy";
import { FinanceNavIcon, type FinanceNavIconName } from "./finance-nav-icon";

type SidebarProps = {
  collapsed: boolean;
  onExpand: () => void;
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
  "product-sales": "sales"
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
  "group flex min-h-10 items-center gap-3 rounded-md border-l-[3px] px-3 py-2.5 text-[13px] font-semibold leading-5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300";

function activeLink(active: boolean): string {
  return active
    ? baseLink + " border-cyan-300 bg-[#1a568b] text-white"
    : baseLink + " border-transparent text-slate-200 hover:bg-white/10 hover:text-white";
}

export function FinanceSidebarNav({
  collapsed, onExpand, showFinance, showMore, showSettings, showPackagePayment,
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
    <nav aria-label="เมนูฝ่ายบัญชี" className={"space-y-2.5 py-3 " + (collapsed ? "px-2" : "px-3")}>
      {!collapsed ? (
        <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
          เมนูหลัก
        </p>
      ) : null}
      {showFinance ? (
        <Link href="/finance" aria-current={pathname === "/finance" ? "page" : undefined}
          title={collapsed ? "การเงิน" : undefined} aria-label="การเงิน"
          className={activeLink(pathname === "/finance") + (collapsed ? " justify-center px-2" : "")}>
          <FinanceNavIcon name="finance" />
          {!collapsed ? <span className="min-w-0 flex-1">การเงิน</span> : null}
        </Link>
      ) : null}

      {showMore ? (
        <section className={collapsed ? "px-1 pt-2" : "border-t border-white/10 px-1 pt-2"}>
          <button type="button" aria-expanded={!collapsed && moreOpen} aria-controls="finance-more-menu"
            aria-label="เพิ่มเติม" title={collapsed ? "เพิ่มเติม" : undefined}
            onClick={() => { if (collapsed) { onExpand(); setMoreOpen(true); } else setMoreOpen(open => !open); }}
            className={"flex min-h-10 w-full items-center gap-3 rounded-md py-2 text-left text-[13px] font-bold text-slate-100 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 " + (collapsed ? "justify-center px-1" : "px-2.5")}>
            <FinanceNavIcon name="more" />
            {!collapsed ? <span className="min-w-0 flex-1">เพิ่มเติม</span> : null}
            {!collapsed ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={"h-4 w-4 shrink-0 transition-transform " + (moreOpen ? "rotate-180" : "")}>
              <path d="m6 9 6 6 6-6" />
            </svg> : null}
          </button>
          {!collapsed && moreOpen ? (
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
        <section className={collapsed ? "px-1 pt-2" : "border-t border-white/10 px-1 pt-2"}>
          <button type="button" aria-expanded={!collapsed && settingsOpen} aria-controls="finance-settings-menu"
            aria-label="ตั้งค่า" title={collapsed ? "ตั้งค่า" : undefined}
            onClick={() => { if (collapsed) { onExpand(); setSettingsOpen(true); } else setSettingsOpen(open => !open); }}
            className={"flex min-h-10 w-full items-center gap-3 rounded-md py-2 text-left text-[13px] font-bold text-slate-100 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 " + (collapsed ? "justify-center px-1" : "px-2.5")}>
            <FinanceNavIcon name="settings" />
            {!collapsed ? <span className="min-w-0 flex-1">ตั้งค่า</span> : null}
            {!collapsed ? <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={"h-4 w-4 shrink-0 transition-transform " + (settingsOpen ? "rotate-180" : "")}>
              <path d="m6 9 6 6 6-6" />
            </svg> : null}
          </button>
          {!collapsed && settingsOpen ? (
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
          title={collapsed ? "ชำระแพ็กเกจ" : undefined} aria-label="ชำระแพ็กเกจ"
          className={activeLink(pathname === "/finance/package-payment") + (collapsed ? " justify-center px-2" : "")}>
          <FinanceNavIcon name="package" />
          {!collapsed ? <span className="min-w-0 flex-1">ชำระแพ็กเกจ</span> : null}
        </Link>
      ) : null}
    </nav>
  );
}
