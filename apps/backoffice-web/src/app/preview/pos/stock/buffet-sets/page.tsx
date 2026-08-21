import { PosBackButton } from "@/components/pos-preview/pos-back-button";
import { PosBuffetSetManagerWorkspace } from "@/components/pos-preview/pos-buffet-set-manager-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosBuffetSetManagerPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePosPagePermission("tables:manage");
  const lang = await getCurrentLanguage();
  const resolved = (await searchParams) ?? {};
  const rawPlan = resolved.plan;
  const initialPlanId = Array.isArray(rawPlan) ? rawPlan[0] ?? "" : typeof rawPlan === "string" ? rawPlan : "";

  return (
    <div className="min-h-full bg-slate-50">
      <div className="px-3 pt-3 sm:px-5 sm:pt-5">
        <PosBackButton lang={lang} href="/preview/pos/stock" label={lang === "th" ? "กลับจัดการสินค้า" : "Back to Products"} />
      </div>
      <PosBuffetSetManagerWorkspace lang={lang} initialPlanId={initialPlanId} />
    </div>
  );
}
