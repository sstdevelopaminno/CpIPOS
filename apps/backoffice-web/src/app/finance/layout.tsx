import type { ReactNode } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { requireFinanceSession } from "@/lib/server/finance-session";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";
import {
  ACCOUNTANT_MORE_MENU, ACCOUNTANT_SETTINGS_MENU, isAccountantMenuVisible
} from "@/lib/accountant-menu-policy";
import { FinanceLogout } from "./finance-logout";
import { FinanceSidebarNav } from "./finance-sidebar-nav";

export const dynamic = "force-dynamic";

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  const identity = await requireFinanceSession();
  if (!identity) redirect("/login/store?from=finance-session");
  const overrides = await getTenantPosMenuOverrides(identity.tenantId);
  const visible = (key: string) => isAccountantMenuVisible(key, overrides);

  return (
    <div className="flex min-h-screen min-w-0 flex-col bg-slate-100 text-slate-900 md:h-screen md:flex-row">
      <aside className="flex w-full shrink-0 flex-col bg-[linear-gradient(180deg,#103257_0%,#081e3b_52%,#07172f_100%)] text-white md:h-[100dvh] md:w-[252px]">
        <div className="shrink-0 border-b border-white/10 px-4 pb-4 pt-5 text-center">
          <div className="mx-auto flex h-[76px] w-[76px] items-center justify-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10">
            <Image src="/brand/cpipos-symbol-sidebar.png" width={68} height={68}
              alt="โลโก้ CpiPOS" className="h-[68px] w-[68px] object-contain" priority />
          </div>
          <p className="mt-2.5 text-[15px] font-black tracking-wide text-white">
            Cpi<span className="text-cyan-300">POS</span>
          </p>
          <p className="mt-0.5 text-sm font-extrabold text-sky-100">ฝ่ายบัญชี</p>
          <p className="mt-2 truncate rounded-md bg-white/[0.065] px-2.5 py-1.5 text-xs text-slate-300"
            title={identity.name ?? "บัญชี"}>
            {identity.name ?? "บัญชี"} · ทุกสาขาในร้าน
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
          <FinanceSidebarNav
            showFinance={visible("main.finance")}
            showMore={visible("main.more")}
            showSettings={visible("main.settings")}
            showPackagePayment={visible("main.package_payment")}
            moreItems={ACCOUNTANT_MORE_MENU.filter(item => visible(item.key))}
            settingsItems={ACCOUNTANT_SETTINGS_MENU.filter(item => visible(item.key))}
          />
        </div>

        <footer className="mt-auto shrink-0 border-t border-white/15 bg-[#07182f]/90 px-3 py-3">
          <FinanceLogout />
        </footer>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-2 sm:p-3 lg:p-4 has-[.finance-office-workbench]:p-0">
        {children}
      </main>
    </div>
  );
}
