"use client";

import { PrinterConnectionManagerV3 } from "@/components/backoffice/printer-connection-manager-v3";

/**
 * Stable settings entry point.
 * Printer Settings v3 keeps legacy printer_profiles / print_jobs as the
 * execution source of truth while presenting customer-facing LAN / USB /
 * Bluetooth setup, device registry, assignments and connection history.
 */
export function PrintersModule({ lang: _lang = "th" }: { lang?: "th" | "en" }) {
  return <PrinterConnectionManagerV3 />;
}
