import { notFound } from "next/navigation";
import { RecyclingPosWorkspace } from "@/components/pos/recycling-pos-workspace";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { requirePosSession } from "@/lib/pos-session-guard";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { getRecyclingCatalog, isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function RecyclingPosPage() {
  const scope = await requirePosSession();
  await assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos");
  const auth = await requirePosPagePermission("sale:create");
  const { tenant_id: tenantId, branch_id: branchId } = scope.session;
  if (!await isAuthorizedRecyclingTenant(tenantId)) notFound();
  const [products, branch] = await Promise.all([
    getRecyclingCatalog(tenantId, branchId),
    getSupabaseServiceClient().from("branches").select("name")
      .eq("tenant_id", tenantId).eq("id", branchId).maybeSingle()
  ]);
  // Session and permission checks must precede data reads.
  void auth;
  return <RecyclingPosWorkspace products={products} branchName={branch.data?.name ?? "สาขาที่เข้าสู่ระบบ"} />;
}
