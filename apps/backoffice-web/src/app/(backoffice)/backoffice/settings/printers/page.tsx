import { PrinterConnectionManagerV3 } from "@/components/backoffice/printer-connection-manager-v3";
import { PrinterMdmPanel } from "@/components/backoffice/printer-mdm-panel";
import {getCurrentLanguage} from "@/lib/i18n";

export default async function BackofficePrintersSettingsPage() {
  const lang=await getCurrentLanguage();
  return (
    <>
      <PrinterMdmPanel />
      <PrinterConnectionManagerV3 lang={lang} />
    </>
  );
}
