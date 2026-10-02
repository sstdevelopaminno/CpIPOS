import { PrinterConnectionManagerV3 } from "@/components/backoffice/printer-connection-manager-v3";
import { PrinterMdmPanel } from "@/components/backoffice/printer-mdm-panel";

export default function BackofficePrintersSettingsPage() {
  return (
    <>
      <PrinterMdmPanel />
      <PrinterConnectionManagerV3 />
    </>
  );
}
