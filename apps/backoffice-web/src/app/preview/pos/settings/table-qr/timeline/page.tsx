import { redirect } from "next/navigation";
import { TableQrOrderTimeline } from "@/components/pos-preview/table-qr-order-timeline";
import { resolveQrKitchenHardeningFlags } from "@/lib/fg0003-qr-kitchen-hardening";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function TableQrTimelinePage() {
  const scope = await requirePosPagePermission("settings:view");
  const role = String(scope.session.role ?? "").trim().toLowerCase();
  if (role !== "owner" && role !== "manager") redirect("/preview/pos/settings");

  const flags = resolveQrKitchenHardeningFlags({
    tenantId: scope.session.tenant_id,
    branchId: scope.session.branch_id
  });
  if (!flags.qr_pos_review_required) redirect("/preview/pos/settings");

  return <TableQrOrderTimeline />;
}
