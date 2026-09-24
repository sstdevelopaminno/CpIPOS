import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { redirect } from "next/navigation";
import { TableQrOrderTimeline } from "@/components/pos-preview/table-qr-order-timeline";
import { resolveRestaurantQrKitchenFlags } from "@/lib/restaurant-qr-profile";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function TableQrTimelinePage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/settings/table-qr/timeline");
  const scope = await requirePosPagePermission("settings:view");
  const role = String(scope.session.role ?? "").trim().toLowerCase();
  if (role !== "owner" && role !== "manager") redirect("/preview/pos/settings");

  const flags = resolveRestaurantQrKitchenFlags({
    tenantId: scope.session.tenant_id,
    branchId: scope.session.branch_id
  });
  if (!flags.qr_pos_review_required) redirect("/preview/pos/settings");

  return <TableQrOrderTimeline />;
}
