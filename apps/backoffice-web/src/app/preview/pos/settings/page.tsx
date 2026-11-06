import { assertPosMenuPageAllowed, getTenantPosMenuOverrides, isTenantCustomPosPackage } from "@/lib/server/pos-menu-policy-service";
import { PrintersModule } from "@/components/backoffice/printers-module";
import { PosSettingsWorkspace } from "@/components/pos-preview/pos-settings-workspace";
import { PosPersonalSettings } from "@/components/pos-preview/pos-personal-settings";
import { TableQrSettingsMenuPortal } from "@/components/pos-preview/table-qr-settings-menu-portal";
import { loadRestaurantQrKitchenFlagsForScope } from "@/lib/services/restaurant-qr-kitchen-profile-service";
import { getCurrentLanguage } from "@/lib/i18n";
import { isCustomPosMenuVisible, isPosMenuEnabled } from "@/lib/pos-menu-policy";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { requirePosSession } from "@/lib/pos-session-guard";
import { loadPosSettingsSnapshot } from "@/lib/services/pos-settings-service";

export default async function PosLanguageSettingsPage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/settings");
  const sessionScope = await requirePosSession();
  const lang = await getCurrentLanguage();

  const sessionRole = String(sessionScope.session.role ?? "").trim().toLowerCase();

  if (sessionRole === "staff" || sessionRole === "kitchen") {
    const [menuPolicy, isCustom] = await Promise.all([
      getTenantPosMenuOverrides(sessionScope.session.tenant_id),
      isTenantCustomPosPackage(sessionScope.session.tenant_id)
    ]);
    const languageEnabled = isCustom
      ? isCustomPosMenuVisible("settings.language", menuPolicy, true)
      : isPosMenuEnabled("settings.language", menuPolicy);
    const printersEnabled = isCustom
      ? isCustomPosMenuVisible("settings.printers", menuPolicy, true)
      : isPosMenuEnabled("settings.printers", menuPolicy);

    return (
      <div className="h-full min-h-0 flex-1 overflow-y-auto bg-slate-50 p-3 md:p-5">
        <div className="mx-auto grid w-full max-w-5xl gap-4">
          <PosPersonalSettings
            initialLanguage={lang}
            role={sessionRole}
            languageEnabled={languageEnabled}
          />
          {sessionRole === "kitchen" && printersEnabled ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <PrintersModule lang={lang === "lo" ? "en" : lang} />
            </section>
          ) : null}
        </div>
      </div>
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
  const isCustom = canManageTableQr && await isTenantCustomPosPackage(scope.session.tenant_id);
  const settingsMenuPolicy = canManageTableQr
    ? await getTenantPosMenuOverrides(scope.session.tenant_id)
    : {};
  const timelineEnabled = canManageTableQr && (await loadRestaurantQrKitchenFlagsForScope({
    tenantId: scope.session.tenant_id,
    branchId: scope.session.branch_id
  })).qr_pos_review_required;

  return (
    <div className="h-full min-h-0 flex-1 bg-slate-50">
      <PosSettingsWorkspace lang={lang} initialData={initialData} />
      {canManageTableQr ? <TableQrSettingsMenuPortal lang={lang} timelineEnabled={timelineEnabled} menuPolicy={settingsMenuPolicy} isCustom={isCustom} /> : null}
    </div>
  );
}
