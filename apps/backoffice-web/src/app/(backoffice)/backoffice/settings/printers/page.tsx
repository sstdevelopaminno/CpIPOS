import { PrinterConnectionManagerV2 } from "@/components/backoffice/printer-connection-manager-v2";
import { PrinterMdmPanel } from "@/components/backoffice/printer-mdm-panel";

export default function BackofficePrintersSettingsPage() {
  return (
    <>
      <PrinterMdmPanel />
      <PrinterConnectionManagerV2 />
    </>
  );
}
