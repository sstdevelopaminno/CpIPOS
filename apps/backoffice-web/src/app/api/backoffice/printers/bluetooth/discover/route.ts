import { readEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { buildBridgeEnvelope, normalizeBridgeDevices, parseBridgePayload } from "@/lib/printing/bridge-contract";
import { fetchBridgeWithTimeout, resolveBridgeTimeoutMs } from "@/lib/printing/adapters/bridge-timeout";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";

type DiscoverBluetoothPayload = {
  bridge_url?: string | null;
  timeout_ms?: number | null;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    if (auth.branchRole !== "manager" && auth.branchRole !== "owner") {
      return fail("forbidden_role", "Only manager or owner can discover Bluetooth printers.", 403);
    }

    const body = (await req.json()) as DiscoverBluetoothPayload;
    const bridgeUrl =
      normalizeText(body.bridge_url) ??
      readEnv("PRINT_BLUETOOTH_BRIDGE_URL") ??
      readEnv("PRINT_BRIDGE_URL") ??
      null;

    if (!bridgeUrl) {
      return fail("bridge_url_required", "bridge_url is required or set PRINT_BLUETOOTH_BRIDGE_URL.", 422);
    }

    const timeoutMs = resolveBridgeTimeoutMs({ timeout_ms: body.timeout_ms ?? null }, "PRINT_BLUETOOTH_BRIDGE_TIMEOUT_MS", 9000);
    const response = await fetchBridgeWithTimeout(bridgeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "discover_bluetooth_printers",
        transport: "bluetooth",
        timeout_ms: timeoutMs,
        metadata: {
          request_source: "backoffice_printer_settings",
          discover: true
        }
      })
    }, timeoutMs);

    const rawText = await response.text();
    const bridgePayload = parseBridgePayload(rawText);

    if (!response.ok) {
      return fail("bluetooth_discover_failed", `Bridge discovery failed (${response.status}).`, 400);
    }

    const primaryDevices = normalizeBridgeDevices(bridgePayload.devices);
    const nestedDevices = normalizeBridgeDevices((bridgePayload.data as Record<string, unknown> | undefined)?.devices);
    const resultDevices = normalizeBridgeDevices((bridgePayload as Record<string, unknown>).results);
    const devices = primaryDevices.length > 0 ? primaryDevices : nestedDevices.length > 0 ? nestedDevices : resultDevices;

    return ok(
      buildBridgeEnvelope({
        ok: true,
        code: "bluetooth_discover_ok",
        message: "Bluetooth discovery completed.",
        action: "discover_bluetooth_printers",
        data: {
          bridge_url: bridgeUrl,
          timeout_ms: timeoutMs,
          devices
        }
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("timeout")) return fail("bluetooth_discover_timeout", "Bluetooth bridge did not respond in time.", 504);
    return loggedPrintApiFail("bluetooth discover failed", error, "bluetooth_discover_failed", "Bluetooth printers could not be discovered. Please retry.", 400);
  }
}
