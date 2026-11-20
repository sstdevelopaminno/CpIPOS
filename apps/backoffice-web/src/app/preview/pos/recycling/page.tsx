import { requirePosSession } from "@/lib/pos-session-guard";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { RecyclingSalesContent } from "@/components/pos/recycling-sales-content";

export const dynamic = "force-dynamic";

/** Backwards-compatible direct URL, using the SAME shared Recycling screen
 * as the main "หน้าขาย" menu. No second standalone visual shell. */
export default async function RecyclingPosPage() {
 const scope = await requirePosSession();
 await assertPosMenuPageAllowed(scope.session.tenant_id,"/preview/pos");
 await requirePosPagePermission("sale:create");
 return <RecyclingSalesContent
   tenantId={scope.session.tenant_id}
   branchId={scope.session.branch_id}
   deviceCode={scope.session.device_code??null}/>;
}
