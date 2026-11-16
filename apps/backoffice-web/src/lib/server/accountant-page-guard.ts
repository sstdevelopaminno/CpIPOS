import "server-only";

import { notFound, redirect } from "next/navigation";
import { requireFinanceSession, type FinanceIdentity } from "@/lib/server/finance-session";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";
import { isAccountantMenuVisible } from "@/lib/accountant-menu-policy";

export async function requireAccountantPage(menuKey: string): Promise<FinanceIdentity> {
  const identity = await requireFinanceSession();
  if (!identity) redirect("/login/store?from=finance-session");
  // Dynamic direct navigation requires both the role-scoped Finance session and IT policy.
  const overrides = await getTenantPosMenuOverrides(identity.tenantId);
  if (!isAccountantMenuVisible(menuKey, overrides)) notFound();
  return identity;
}
