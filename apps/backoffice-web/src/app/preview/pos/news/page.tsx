import { redirect } from "next/navigation";
import { getCurrentLanguage } from "@/lib/i18n";
import { PosNewsWorkspace } from "@/components/pos-preview/pos-news-workspace";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";

export default async function PosNewsPage() {
  try {
    await requirePosSession();
  } catch (error) {
    if (error instanceof PosGuardError && error.status === 401) redirect("/login/employee");
    throw error;
  }
  return <PosNewsWorkspace lang={await getCurrentLanguage()} />;
}
