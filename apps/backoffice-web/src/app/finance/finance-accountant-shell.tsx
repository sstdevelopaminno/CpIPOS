"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useEffect, useState } from "react";
import type { AccountantNavItem, AccountantFinanceItem } from "@/lib/accountant-menu-policy";
import { FinanceSidebarNav } from "./finance-sidebar-nav";
import { FinanceLogout } from "./finance-logout";

type Props = {
  children: ReactNode;
  showFinance: boolean;
  showSettings: boolean;
  showPackagePayment: boolean;
  financeItems: readonly AccountantFinanceItem[];
  settingsItems: readonly AccountantNavItem[];
};

const STORAGE_KEY = "cpipos:finance-sidebar-collapsed";

export function FinanceAccountantShell({
  children, showFinance, showSettings, showPackagePayment,
  financeItems, settingsItems
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1"); } catch { /* private mode */ }
  }, []);

  function changeCollapsed(next: boolean) {
    setCollapsed(next);
    try { window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch { /* private mode */ }
  }

  return (
    <div className="flex min-h-screen min-w-0 flex-col bg-slate-100 text-slate-900 md:h-screen md:flex-row">
      <aside
        data-collapsed={collapsed}
        className={"flex w-full min-w-0 shrink-0 flex-col bg-[linear-gradient(180deg,#103257_0%,#081e3b_52%,#07172f_100%)] text-white transition-[width] duration-200 ease-out md:h-[100dvh] " +
          (collapsed ? "md:w-[76px]" : "md:w-[252px]")}
      >
        <header className={"relative shrink-0 border-b border-white/10 text-center transition-all " +
          (collapsed ? "px-2 pb-3 pt-12" : "px-4 pb-4 pt-5")}>
          <button
            type="button"
            aria-label={collapsed ? "ขยายแถบเมนูฝ่ายบัญชี" : "ยุบแถบเมนูฝ่ายบัญชี"}
            aria-expanded={!collapsed}
            title={collapsed ? "ขยายเมนู" : "ยุบเมนู"}
            onClick={() => changeCollapsed(!collapsed)}
            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md border border-white/15 bg-white/5 text-sky-100 hover:border-sky-300/60 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className={"h-4 w-4 transition-transform " + (collapsed ? "rotate-180" : "")}
              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </button>
          <Image
            src="/brand/cpipos-symbol-transparent.png" width={collapsed ? 48 : 84}
            height={collapsed ? 48 : 84} alt="โลโก้ CpiPOS"
            className={"mx-auto object-contain " + (collapsed ? "h-12 w-12" : "h-[84px] w-[84px]")}
            priority
          />
          {!collapsed ? (
            <>
              <p className="mt-2 text-[15px] font-black tracking-wide text-white">Cpi<span className="text-cyan-300">POS</span></p>
              <p className="mt-0.5 text-sm font-extrabold text-sky-100">ฝ่ายบัญชี</p>
            </>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <FinanceSidebarNav
            collapsed={collapsed}
            onExpand={() => changeCollapsed(false)}
            showFinance={showFinance}
            showSettings={showSettings}
            showPackagePayment={showPackagePayment}
            financeItems={financeItems}
            settingsItems={settingsItems}
          />
        </div>

        <footer className="mt-auto shrink-0 border-t border-white/15 bg-[#07182f]/90 px-2 py-3">
          <FinanceLogout collapsed={collapsed} />
        </footer>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-2 sm:p-3 lg:p-4 has-[.finance-office-workbench]:p-0 has-[.finance-secondary-workbench]:p-0">
        {children}
      </main>
    </div>
  );
}
