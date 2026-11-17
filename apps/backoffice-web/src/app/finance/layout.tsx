import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireFinanceSession } from "@/lib/server/finance-session";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";
import {
  ACCOUNTANT_MORE_MENU, ACCOUNTANT_SETTINGS_MENU, isAccountantMenuVisible
} from "@/lib/accountant-menu-policy";
import { FinanceAccountantShell } from "./finance-accountant-shell";

export const dynamic = "force-dynamic";

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  const identity = await requireFinanceSession();
  if (!identity) redirect("/login/store?from=finance-session");
  const overrides = await getTenantPosMenuOverrides(identity.tenantId);
  const visible = (key: string) => isAccountantMenuVisible(key, overrides);

  return (
    <FinanceAccountantShell
      showFinance={visible("main.finance")}
      showMore={visible("main.more")}
      showSettings={visible("main.settings")}
      showPackagePayment={visible("main.package_payment")}
      moreItems={ACCOUNTANT_MORE_MENU.filter(item => visible(item.key))}
      settingsItems={ACCOUNTANT_SETTINGS_MENU.filter(item => visible(item.key))}
    >
      {children}
    </FinanceAccountantShell>
  );
}
