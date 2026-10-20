import { PrinterConnectionManagerV3 } from "@/components/backoffice/printer-connection-manager-v3";
import { PrinterMdmPanel } from "@/components/backoffice/printer-mdm-panel";
import {getCurrentLanguage} from "@/lib/i18n";

export default async function BackofficePrintersSettingsPage() {
  const lang=await getCurrentLanguage();
  return (
    <>
      <PrinterConnectionManagerV3 lang={lang} />
      <details className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          {lang==="lo"?"ຈັດການອຸປະກອນ POS / MDM":lang==="en"?"Advanced POS devices / MDM":"จัดการเครื่อง POS และอุปกรณ์ขั้นสูง (MDM)"}
        </summary>
        <div className="mt-4"><PrinterMdmPanel /></div>
      </details>
    </>
  );
}
