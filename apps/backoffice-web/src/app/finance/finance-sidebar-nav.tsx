"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { AccountantNavItem, AccountantFinanceItem } from "@/lib/accountant-menu-policy";
import { FinanceNavIcon, type FinanceNavIconName } from "./finance-nav-icon";

type SidebarProps = {
  collapsed: boolean;
  onExpand: () => void;
  showFinance: boolean;
  showSettings: boolean;
  showPackagePayment: boolean;
  financeItems: readonly AccountantFinanceItem[];
  settingsItems: readonly AccountantNavItem[];
};

const financeIcons: Record<string, FinanceNavIconName> = {
  income: "income",
  expenses: "expense",
  "sales-receivables": "receivables",
  "pos-receipts": "receipt",
  "purchases-payables": "payables",
  banking: "bank",
  ledger: "ledger",
  "posted-journals": "list",
  "tax-reports": "reports"
};

const settingsIcons: Record<string, FinanceNavIconName> = {
  branding: "palette", store: "store", printers: "printer",
  payments: "payments", taxes: "tax", support: "support",
  "push-notifications": "notifications", language: "language",
  currency: "payments", placement: "layout"
};

const baseLink =
  "group flex min-h-10 items-center gap-3 rounded-md border-l-[3px] px-3 py-2.5 text-[13px] font-semibold leading-5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300";
const activeLink = (active: boolean) => baseLink +
  (active ? " border-cyan-300 bg-[#1a568b] text-white" :
    " border-transparent text-slate-200 hover:bg-white/10 hover:text-white");

function Chevron({ open }: { open: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    className={"h-4 w-4 shrink-0 transition-transform " + (open ? "rotate-180" : "")}>
    <path d="m6 9 6 6 6-6" />
  </svg>;
}

export function FinanceSidebarNav({
  collapsed, onExpand, showFinance, showSettings, showPackagePayment,
  financeItems, settingsItems
}: SidebarProps) {
  const pathname = usePathname();
  const [financeOpen, setFinanceOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(() => pathname.startsWith("/finance/settings"));

  useEffect(() => {
    if (financeItems.some(item => pathname === "/finance/" + item.slug)) setFinanceOpen(true);
    if (pathname.startsWith("/finance/settings")) setSettingsOpen(true);
  }, [pathname, financeItems]);

  return (
    <nav aria-label="เมนูฝ่ายบัญชี" className={"space-y-2.5 py-3 " + (collapsed ? "px-2" : "px-3")}>
      {!collapsed && <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">เมนูหลัก</p>}
      {showFinance && (
        <section className={collapsed ? "px-1" : "px-1"}>
          <div className="flex min-w-0 items-center">
            <Link href="/finance" aria-current={pathname === "/finance" ? "page" : undefined}
              aria-label="การเงิน" title={collapsed ? "การเงิน" : undefined}
              className={activeLink(pathname === "/finance") + (collapsed ? " justify-center px-2" : " flex-1")}>
              <FinanceNavIcon name="finance" />
              {!collapsed && <span className="min-w-0 flex-1">การเงิน</span>}
            </Link>
            {!collapsed && (
              <button type="button" aria-label="ยุบหรือขยายเมนูย่อยการเงิน"
                aria-controls="finance-module-menu" aria-expanded={financeOpen}
                onClick={() => setFinanceOpen(open => !open)}
                className="ml-1 flex h-10 w-9 shrink-0 items-center justify-center rounded-md text-slate-200 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">
                <Chevron open={financeOpen} />
              </button>
            )}
          </div>
          {!collapsed && financeOpen && (
            <div id="finance-module-menu" className="mt-1 space-y-0.5 border-l border-sky-300/25 pl-1.5">
              {financeItems.map(item => {
                const href = "/finance/" + item.slug;
                return <Link href={href} key={item.key} aria-current={pathname === href ? "page" : undefined}
                  className={activeLink(pathname === href)}>
                  <FinanceNavIcon name={financeIcons[item.slug] ?? "list"} className="h-[16px] w-[16px]" />
                  <span className="min-w-0 flex-1 leading-5">{item.label}</span>
                </Link>;
              })}
            </div>
          )}
          {collapsed && financeItems.length > 0 && (
            <button type="button" onClick={() => { onExpand(); setFinanceOpen(true); }}
              title="แสดงเมนูย่อยการเงิน" aria-label="ขยายเมนูย่อยการเงิน"
              className="mt-1 flex h-8 w-full items-center justify-center rounded-md text-sky-200 hover:bg-white/10">
              <Chevron open={false} />
            </button>
          )}
        </section>
      )}
      {showSettings && (
        <section className={collapsed ? "px-1 pt-2" : "border-t border-white/10 px-1 pt-2"}>
          <button type="button" aria-expanded={!collapsed && settingsOpen} aria-controls="finance-settings-menu"
            aria-label="ตั้งค่า" title={collapsed ? "ตั้งค่า" : undefined}
            onClick={() => { if (collapsed) { onExpand(); setSettingsOpen(true); } else setSettingsOpen(open => !open); }}
            className={"flex min-h-10 w-full items-center gap-3 rounded-md py-2 text-left text-[13px] font-bold text-slate-100 transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300 " + (collapsed ? "justify-center px-1" : "px-2.5")}>
            <FinanceNavIcon name="settings" />
            {!collapsed && <span className="min-w-0 flex-1">ตั้งค่า</span>}
            {!collapsed && <Chevron open={settingsOpen} />}
          </button>
          {!collapsed && settingsOpen && (
            <div id="finance-settings-menu" className="mt-1 space-y-0.5 border-l border-sky-300/25 pl-1.5">
              {settingsItems.map(item => {
                const href = "/finance/settings/" + item.slug;
                return <Link href={href} key={item.key} aria-current={pathname === href ? "page" : undefined}
                  className={activeLink(pathname === href)}>
                  <FinanceNavIcon name={settingsIcons[item.slug] ?? "settings"} className="h-[16px] w-[16px]" />
                  <span className="min-w-0 flex-1 leading-5">{item.label}</span>
                </Link>;
              })}
            </div>
          )}
        </section>
      )}
      {showPackagePayment && (
        <Link href="/finance/package-payment" aria-current={pathname === "/finance/package-payment" ? "page" : undefined}
          title={collapsed ? "ชำระแพ็กเกจ" : undefined} aria-label="ชำระแพ็กเกจ"
          className={activeLink(pathname === "/finance/package-payment") + (collapsed ? " justify-center px-2" : "")}>
          <FinanceNavIcon name="package" />
          {!collapsed && <span className="min-w-0 flex-1">ชำระแพ็กเกจ</span>}
        </Link>
      )}
    </nav>
  );
}
