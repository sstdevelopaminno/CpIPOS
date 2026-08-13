"use client";

import { PrinterConnectionManagerV3 } from "@/components/backoffice/printer-connection-manager-v3";

/**
 * Customer-facing printer settings entry point.
 *
 * V3 is the current UI. Transport compatibility is handled by the discovery
 * and device registry APIs so LAN / USB / Bluetooth remain user-facing modes
 * while Runtime / Print Agent stays an internal transport detail.
 */
export function PrintersModule({ lang: _lang = "th" }: { lang?: "th" | "en" }) {
  return <PrinterConnectionManagerV3 />;
}
