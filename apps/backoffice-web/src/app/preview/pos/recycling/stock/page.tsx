import { notFound } from "next/navigation";
import { RecyclingStockWorkspace } from "@/components/pos/recycling-stock-workspace";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { requirePosSession } from "@/lib/pos-session-guard";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { getRecyclingCatalog, isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function RecyclingStockPage() {
  const scope = await requirePosSession();
  await assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos/stock");
  await requirePosPagePermission("inventory:view");
  const { tenant_id: tenantId, branch_id: branchId } = scope.session;
  if (!await isAuthorizedRecyclingTenant(tenantId)) notFound();
  const [items, branch] = await Promise.all([
    getRecyclingCatalog(tenantId, branchId),
    getSupabaseServiceClient().from("branches").select("name")
      .eq("tenant_id", tenantId).eq("id", branchId).maybeSingle()
  ]);
  return <RecyclingStockWorkspace items={items} branchName={branch.data?.name ?? "สาขาที่เข้าสู่ระบบ"} />;
}
