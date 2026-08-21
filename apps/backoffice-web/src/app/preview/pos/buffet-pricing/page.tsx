import { PosBuffetPriceSettingsWorkspace } from "@/components/pos-preview/pos-buffet-price-settings-workspace";
import { PosBackButton } from "@/components/pos-preview/pos-back-button";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosBuffetPricingPage() {
  await requirePosPagePermission("tables:manage");
  const lang = await getCurrentLanguage();
  return (
    <main className="min-h-full bg-slate-50">
      <div className="px-3 pt-3 sm:px-5 sm:pt-5">
        <PosBackButton lang={lang} href="/preview/pos/more" label={lang === "th" ? "กลับเมนูเพิ่มเติม" : "Back to More"} />
      </div>
      <PosBuffetPriceSettingsWorkspace lang={lang} />
    </main>
  );
}
