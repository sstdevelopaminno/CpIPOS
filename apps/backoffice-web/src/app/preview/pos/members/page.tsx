import { PosMemberMaintenanceModal } from "@/components/pos/pos-member-maintenance-modal";
import { PosBackButton } from "@/components/pos-preview/pos-back-button";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosMembersPage() {
  await requirePosPagePermission("sales:enter");
  const lang = await getCurrentLanguage();
  return (
    <main className="min-h-full bg-slate-50">
      <div className="p-4">
        <PosBackButton lang={lang} href="/preview/pos/more" label={lang === "th" ? "กลับเมนูเพิ่มเติม" : "Back to More"} />
      </div>
      <PosMemberMaintenanceModal open lang={lang} closeLabel={lang === "th" ? "< กลับเมนูเพิ่มเติม" : "< Back to More"} onCloseHref="/preview/pos/more" />
    </main>
  );
}
