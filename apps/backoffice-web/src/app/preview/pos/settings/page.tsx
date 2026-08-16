import { PrintersModule } from "@/components/backoffice/printers-module";
import { PosSettingsWorkspace } from "@/components/pos-preview/pos-settings-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { requirePosSession } from "@/lib/pos-session-guard";
import { loadPosSettingsSnapshot } from "@/lib/services/pos-settings-service";

export default async function PosLanguageSettingsPage() {
  const sessionScope = await requirePosSession();
  const lang = await getCurrentLanguage();

  if (String(sessionScope.session.role ?? "").trim().toLowerCase() === "kitchen") {
    return (
      <section className="h-full min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3 md:p-5">
        <PrintersModule lang={lang} />
      </section>
    );
  }

  const scope = await requirePosPagePermission("settings:view");
  const initialData = await loadPosSettingsSnapshot({
    userId: scope.session.user_id,
    tenantId: scope.session.tenant_id,
    branchId: scope.session.branch_id,
    branchRole: scope.session.role === "owner" || scope.session.role === "manager" || scope.session.role === "accountant" ? scope.session.role : "staff",
    platformRole: "tenant_user"
  });

  return <PosSettingsWorkspace lang={lang} initialData={initialData} />;
}
