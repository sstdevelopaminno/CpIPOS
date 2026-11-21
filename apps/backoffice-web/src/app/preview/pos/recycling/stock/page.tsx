import { notFound } from "next/navigation";
import { RecyclingStockWorkspace } from "@/components/pos/recycling-stock-workspace";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { requirePosSession } from "@/lib/pos-session-guard";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { getRecyclingCatalog, isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getRecyclingStockBranches, requireRecyclingStockBranch } from "@/lib/server/recycling-stock-branch-scope";
import { requireTenantFeature } from "@/lib/feature-gate";
import { loadProductMediaMap } from "@/lib/product-media";

export const dynamic = "force-dynamic";

export default async function RecyclingStockPage({
  searchParams
}: {
  searchParams?: Promise<{ branch_id?: string | string[] }>;
}) {
  const scope = await requirePosSession();
  const {tenant_id: tenantId, branch_id: sessionBranchId} = scope.session;
  await assertPosMenuPageAllowed(tenantId, "/preview/pos/stock");
  await requirePosPagePermission("inventory:view");
  if (!await isAuthorizedRecyclingTenant(tenantId)) notFound();

  const branches = await getRecyclingStockBranches(scope);
  const params = await searchParams;
  const raw = Array.isArray(params?.branch_id) ? params.branch_id[0] : params?.branch_id;
  const branch = requireRecyclingStockBranch(
    raw?.trim() || sessionBranchId, branches, false
  );
  // A branch-specific IT restriction must not be bypassed merely because the
  // cashier has stock access in their logged-in branch.
  await requireTenantFeature(tenantId, "stock_management", branch.id);
  const items = await getRecyclingCatalog(tenantId, branch.id);
  // Only the stock UI reads photo assets; the cashier barcode path stays fast.
  const media = await loadProductMediaMap({tenantId,branchId:branch.id});
  const mediaByProduct:Record<string,string> = {};
  for(const item of items){
    const asset=media.get(item.id);
    if(asset)mediaByProduct[item.id]=asset.thumbnail_url;
  }

  return <RecyclingStockWorkspace
    key={branch.id}
    items={items}
    mediaByProduct={mediaByProduct}
    branches={branches}
    branchId={branch.id}
    branchName={branch.name}
    canManage={branch.canManage}
  />;
}
