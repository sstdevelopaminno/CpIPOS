import { readEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { buildBridgeEnvelope, parseBridgePayload } from "@/lib/printing/bridge-contract";
import { fetchBridgeWithTimeout, resolveBridgeTimeoutMs } from "@/lib/printing/adapters/bridge-timeout";
import { loggedPrintApiFail } from "@/lib/printing/print-api-errors";

type ConnectBluetoothPayload = {
  bridge_url?: string | null;
  bluetooth_address?: string | null;
  bluetooth_name?: string | null;
  auto_connect?: boolean | null;
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
      return fail("forbidden_role", "Only manager or owner can connect Bluetooth printers.", 403);
    }

    const body = (await req.json()) as ConnectBluetoothPayload;
    const bridgeUrl =
      normalizeText(body.bridge_url) ??
      readEnv("PRINT_BLUETOOTH_BRIDGE_URL") ??
      readEnv("PRINT_BRIDGE_URL") ??
      null;
    if (!bridgeUrl) {
      return fail("bridge_url_required", "bridge_url is required or set PRINT_BLUETOOTH_BRIDGE_URL.", 422);
    }

    const bluetoothAddress = normalizeText(body.bluetooth_address);
    const bluetoothName = normalizeText(body.bluetooth_name);
    if (!bluetoothAddress && !bluetoothName) {
      return fail("bluetooth_target_required", "bluetooth_address or bluetooth_name is required.", 422);
    }

    const timeoutMs = resolveBridgeTimeoutMs({ timeout_ms: body.timeout_ms ?? null }, "PRINT_BLUETOOTH_BRIDGE_TIMEOUT_MS", 8000);
    const response = await fetchBridgeWithTimeout(bridgeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "connect_bluetooth_printer",
        transport: "bluetooth",
        timeout_ms: timeoutMs,
        metadata: {
          request_source: "backoffice_printer_settings",
          auto_connect: body.auto_connect !== false,
          bluetooth_address: bluetoothAddress,
          bluetooth_name: bluetoothName
        }
      })
    }, timeoutMs);

    const rawText = await response.text();
    const bridgePayload = parseBridgePayload(rawText);

    if (!response.ok) {
      return fail("bluetooth_connect_failed", `Bridge connect failed (${response.status}).`, 400);
    }

    return ok(
      buildBridgeEnvelope({
        ok: true,
        code: "bluetooth_connect_ok",
        message: "Bluetooth connect request completed.",
        action: "connect_bluetooth_printer",
        data: {
          bridge_url: bridgeUrl,
          bluetooth_address: bluetoothAddress,
          bluetooth_name: bluetoothName,
          auto_connect: body.auto_connect !== false,
          timeout_ms: timeoutMs,
          bridge_response: bridgePayload
        }
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("timeout")) return fail("bluetooth_connect_timeout", "Bluetooth bridge did not respond in time.", 504);
    return loggedPrintApiFail("bluetooth connect failed", error, "bluetooth_connect_failed", "Bluetooth printer could not be connected. Please retry.", 400);
  }
}
