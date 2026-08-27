import type { BranchRole } from "@pos/shared-types";
import { PosSalesSummaryDashboard } from "@/components/pos-preview/pos-sales-summary-dashboard";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { loadPosSalesSummaryData } from "@/lib/services/pos-sales-summary-service";
import styles from "./sales-summary-responsive.module.css";

export default async function PosSalesSummaryPage() {
  const scope = await requirePosPagePermission("reports:view");
  const lang = await getCurrentLanguage();
  const initialPayload = await loadPosSalesSummaryData({
    userId: scope.session.user_id,
    tenantId: scope.session.tenant_id,
    branchId: scope.session.branch_id,
    branchRole: scope.session.role as BranchRole,
    platformRole: "tenant_user"
  });

  return (
    <div className={styles.page}>
      <PosSalesSummaryDashboard lang={lang} initialPayload={initialPayload} />
    </div>
  );
}
