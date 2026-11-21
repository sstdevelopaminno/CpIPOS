import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { PosShiftHistoryModule } from "@/components/pos/pos-shift-history-module";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { isAuthorizedCustomGeneralSaleTenant } from "@/lib/server/recycling-general-sale-entitlement";
import { notFound } from "next/navigation";
import Link from "next/link";
import RecyclingShiftHistoryPageContent from "@/components/pos/recycling-shift-history-page-content";

export default async function PosShiftPage({ searchParams }: {
  searchParams?: Promise<{ mode?: string }>;
}) {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/shift");
  await requirePosPagePermission("shift:join");
  const recyclingEnabled = await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id);
  const generalSaleEnabled = recyclingEnabled &&
    await isAuthorizedCustomGeneralSaleTenant(posMenuScope.session.tenant_id);
  const mode = (await searchParams)?.mode;

  if (recyclingEnabled && mode === "general" && !generalSaleEnabled) notFound();
  if (recyclingEnabled && mode !== "general") {
    return <RecyclingShiftHistoryPageContent showGeneralShiftLink={generalSaleEnabled} />;
  }
  const lang = await getCurrentLanguage();
  if (recyclingEnabled && generalSaleEnabled) {
    return <>
      <nav aria-label="โหมดกะของร้าน" className="mx-auto flex max-w-[1480px] justify-end px-4 pt-4">
        <Link href="/preview/pos/shift" className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700">
          กลับไปดูกะรับซื้อ–ขายออก
        </Link>
      </nav>
      <PosShiftHistoryModule lang={lang} />
    </>;
  }
  return <PosShiftHistoryModule lang={lang} />;
}
