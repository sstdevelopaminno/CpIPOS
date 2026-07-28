import type { PrinterAdapter } from "@/lib/printing/adapters/types";
import { readEnv } from "@/lib/env";
import { fetchBridgeWithTimeout, resolveBridgeTimeoutMs } from "@/lib/printing/adapters/bridge-timeout";

export class LocalBridgeAdapter implements PrinterAdapter {
  readonly connectionType = "LOCAL_BRIDGE" as const;

  async print(ctx: Parameters<PrinterAdapter["print"]>[0]) {
    const envBridgeUrl = readEnv("PRINT_BRIDGE_URL");
    const bridgeUrl =
      typeof ctx.metadata.bridge_url === "string"
        ? ctx.metadata.bridge_url
        : typeof envBridgeUrl === "string"
          ? envBridgeUrl
          : null;

    if (!bridgeUrl) {
      throw new Error("LOCAL_BRIDGE requires metadata.bridge_url or PRINT_BRIDGE_URL.");
    }

    const timeoutMs = resolveBridgeTimeoutMs(ctx.metadata, "PRINT_LOCAL_BRIDGE_TIMEOUT_MS");
    const response = await fetchBridgeWithTimeout(bridgeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: ctx.metadata.command === "open_cash_drawer" ? "cash_drawer_open" : "print",
        printer_id: ctx.printerId,
        printer_name: ctx.printerName,
        payload_text: ctx.payloadText,
        payload_html: ctx.payloadHtml ?? null,
        metadata: ctx.metadata
      })
    }, timeoutMs);

    if (!response.ok) {
      throw new Error(`LOCAL_BRIDGE request failed with status ${response.status}.`);
    }

    return {
      metadata: {
        bridge_url: bridgeUrl,
        command: ctx.metadata.command === "open_cash_drawer" ? "open_cash_drawer" : "print",
        timeout_ms: timeoutMs
      }
    };
  }
}
