"use client";

import { PrinterConnectionManagerV2 } from "@/components/backoffice/printer-connection-manager-v2";

/**
 * Stable settings entry point.
 *
 * Keep the customer-facing printer settings on v2 for the production
 * hotfix. v2 retains the proven LAN / USB / Bluetooth workflows while
 * v3 remains available for further validation without blocking stores.
 */
export function PrintersModule({ lang: _lang = "th" }: { lang?: "th" | "en" }) {
  return <PrinterConnectionManagerV2 />;
}
