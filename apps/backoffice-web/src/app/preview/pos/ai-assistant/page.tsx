import { redirect } from "next/navigation";
import { CpiPosAiAssistant } from "@/components/pos-preview/cpipos-ai-assistant";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosSession } from "@/lib/pos-session-guard";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";

export const dynamic = "force-dynamic";

export default async function PosAiAssistantPage() {
  const scope = await requirePosSession();
  if (scope.session.role !== "owner" && scope.session.role !== "manager") {
    redirect("/preview/pos/more");
  }

  await assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos/ai-assistant");
  const lang = await getCurrentLanguage();
  return <CpiPosAiAssistant lang={lang} />;
}
