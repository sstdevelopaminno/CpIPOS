import { PosCustomerDisplayV2Native } from "@/components/pos/pos-customer-display-v2-native";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function CustomerDisplayV2NativePage() {
  const lang = await getCurrentLanguage();

  return (
    <>
      <style>{`
        /* Dual-screen customer display branding: icon-only, larger, no duplicate CpIPOS wordmark. */
        [data-cdv2-native="1"] .cdv2-system-wordmark,
        [data-cdv2-native="1"] .cdv2-powered,
        [data-cdv2-native="1"] .cdv2-idle-name {
          display: none !important;
        }

        [data-cdv2-native="1"] .cdv2-system-brand {
          gap: 0 !important;
        }

        [data-cdv2-native="1"] .cdv2-system-symbol {
          width: min(72%, 420px) !important;
          max-height: 78% !important;
        }

        [data-cdv2-native="1"] .cdv2-media .cdv2-system-symbol {
          width: min(82%, 460px) !important;
          max-height: 84% !important;
        }

        [data-cdv2-native="1"] .cdv2-idle-logo {
          width: min(74vw, 760px) !important;
          height: min(58vh, 460px) !important;
        }
      `}</style>
      <PosCustomerDisplayV2Native lang={lang} />
    </>
  );
}
