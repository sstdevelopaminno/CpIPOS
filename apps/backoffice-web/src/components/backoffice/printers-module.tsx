"use client";

import { PrinterConnectionManagerV2 } from "@/components/backoffice/printer-connection-manager-v2";

/**
 * Legacy compatibility wrapper.
 *
 * Several POS/backoffice settings surfaces still import `PrintersModule`.
 * Keep the exported name stable, but render the new customer-facing
 * Printer Connection Manager v2 everywhere so no route can fall back to
 * the old Browser Print Agent / Web Serial advanced settings UI.
 */
export function PrintersModule({ lang: _lang = "th" }: { lang?: "th" | "en" }) {
  return <PrinterConnectionManagerV2 />;
}
