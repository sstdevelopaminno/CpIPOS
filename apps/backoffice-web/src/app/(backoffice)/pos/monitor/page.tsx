import { PosMonitorDashboard } from "@/components/pos/pos-monitor-dashboard";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function PosMonitorPage() {
  const lang = await getCurrentLanguage();
  return <PosMonitorDashboard lang={lang === "lo" ? "en" : lang} />;
}
