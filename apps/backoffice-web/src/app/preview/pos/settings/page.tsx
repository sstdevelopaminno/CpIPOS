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
  const role = String(scope.session.role ?? "").trim().toLowerCase();
  const canManageTableQr = role === "owner" || role === "manager";

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-slate-50">
      {canManageTableQr ? (
        <div className="shrink-0 border-b border-slate-200 bg-white px-3 py-2.5 md:px-5">
          <a
            href="/preview/pos/settings/table-qr"
            className="mx-auto flex max-w-7xl items-center justify-between gap-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 transition hover:border-blue-300 hover:bg-blue-100/70"
          >
            <span className="min-w-0">
              <strong className="block text-sm font-black text-blue-950">{lang === "th" ? "ตั้งค่า QR โต๊ะ" : "Table QR Settings"}</strong>
              <span className="mt-0.5 block text-xs font-semibold text-blue-700">
                {lang === "th" ? "กำหนดหมดอายุตามเวลา/ชั่วโมง หรือใช้งานตามบิล" : "Choose timed/hourly expiry or bill-lifecycle mode"}
              </span>
            </span>
            <span className="shrink-0 text-xl font-black text-blue-700" aria-hidden="true">›</span>
          </a>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <PosSettingsWorkspace lang={lang} initialData={initialData} />
      </div>
    </div>
  );
}
