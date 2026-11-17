import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireFinanceSession } from "@/lib/server/finance-session";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";
import {
  ACCOUNTANT_MORE_MENU, ACCOUNTANT_SETTINGS_MENU, isAccountantMenuVisible
} from "@/lib/accountant-menu-policy";
import { FinanceLogout } from "./finance-logout";

export const dynamic = "force-dynamic";

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  const identity = await requireFinanceSession();
  if (!identity) redirect("/login/store?from=finance-session");
  const overrides = await getTenantPosMenuOverrides(identity.tenantId);
  const visible = (key: string) => isAccountantMenuVisible(key, overrides);

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 text-slate-900 md:h-screen md:flex-row">
      <aside className="w-full shrink-0 bg-[linear-gradient(180deg,#102a46,#071a35_65%,#0a1d42)] p-4 text-white md:h-full md:w-64 md:overflow-y-auto">
        <div className="mb-5 border-b border-white/15 pb-4">
          <p className="text-sm font-bold tracking-wide text-cyan-300">CpiPOS</p>
          <p className="mt-1 text-lg font-extrabold">ฝ่ายบัญชี</p>
          <p className="mt-1 truncate text-xs text-slate-300">{identity.name ?? "บัญชี"} · ทุกสาขาในร้าน</p>
        </div>
        <nav aria-label="เมนูฝ่ายบัญชี" className="space-y-2 text-sm">
          {visible("main.finance") ? <Link className="block rounded-lg px-3 py-2 font-bold hover:bg-white/10" href="/finance">▣ การเงิน</Link> : null}
          {visible("main.more") ? (
            <details open className="rounded-xl border border-white/10 bg-white/5 p-2">
              <summary className="cursor-pointer px-2 py-1.5 font-bold">▦ เพิ่มเติม</summary>
              <div className="mt-1 space-y-1">
                {ACCOUNTANT_MORE_MENU.filter(item => visible(item.key)).map(item =>
                  <Link key={item.key} href={`/finance/more/${item.slug}`} className="block rounded-lg px-3 py-2 text-slate-100 hover:bg-white/10">{item.label}</Link>
                )}
              </div>
            </details>
          ) : null}
          {visible("main.settings") ? (
            <details className="rounded-xl border border-white/10 bg-white/5 p-2">
              <summary className="cursor-pointer px-2 py-1.5 font-bold">⚙ ตั้งค่า</summary>
              <div className="mt-1 space-y-1">
                {ACCOUNTANT_SETTINGS_MENU.filter(item => visible(item.key)).map(item =>
                  <Link key={item.key} href={`/finance/settings/${item.slug}`} className="block rounded-lg px-3 py-2 text-slate-100 hover:bg-white/10">{item.label}</Link>
                )}
              </div>
            </details>
          ) : null}
          {visible("main.package_payment") ?
            <Link className="block rounded-lg px-3 py-2 font-bold hover:bg-white/10" href="/finance/package-payment">▤ ชำระแพ็กเกจ</Link> : null}
        </nav>
        <div className="mt-6 border-t border-white/15 pt-4"><FinanceLogout /></div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto p-2 sm:p-3 lg:p-4">{children}</main>
    </div>
  );
}
