import { PosMemberMaintenanceModal } from "@/components/pos/pos-member-maintenance-modal";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosMembersPage() {
  await requirePosPagePermission("sales:enter");
  const lang = await getCurrentLanguage();
  return (
    <main className="min-h-full bg-slate-50">
      <PosMemberMaintenanceModal open lang={lang} />
    </main>
  );
}
