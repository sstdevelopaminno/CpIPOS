import type { PrinterAdapter } from "@/lib/printing/adapters/types";
import { readEnv } from "@/lib/env";
import { fetchBridgeWithTimeout, resolveBridgeTimeoutMs } from "@/lib/printing/adapters/bridge-timeout";

function normalizeBridgeUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function isCashDrawerCommand(metadata: Record<string, unknown>) {
  const command = String(metadata.command ?? metadata.action ?? "").trim().toLowerCase();
  return command === "open_cash_drawer" || command === "cash_drawer_open";
}

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

    const bridgeToken =
      typeof ctx.metadata.bridge_token === "string"
        ? ctx.metadata.bridge_token
        : typeof readEnv("PRINT_BRIDGE_TOKEN") === "string"
          ? readEnv("PRINT_BRIDGE_TOKEN")
          : null;
    const drawerCommand = isCashDrawerCommand(ctx.metadata);
    const timeoutMs = resolveBridgeTimeoutMs(ctx.metadata, "PRINT_LOCAL_BRIDGE_TIMEOUT_MS");
    const endpoint = drawerCommand ? `${normalizeBridgeUrl(bridgeUrl)}/cash-drawer/open` : bridgeUrl;
    const response = await fetchBridgeWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bridgeToken ? { "X-CpIPOS-Bridge-Token": bridgeToken } : {})
      },
      body: JSON.stringify({
        action: drawerCommand ? "cash_drawer_open" : "print",
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
        bridge_url: endpoint,
        command: drawerCommand ? "open_cash_drawer" : "print",
        timeout_ms: timeoutMs
      }
    };
  }
}
