import { readEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { getAuthContext } from "@/lib/auth-context";
import { buildBridgeEnvelope, parseBridgePayload } from "@/lib/printing/bridge-contract";
import { fetchBridgeWithTimeout, resolveBridgeTimeoutMs } from "@/lib/printing/adapters/bridge-timeout";

type BluetoothHealthPayload = {
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
      return fail("forbidden_role", "Only manager or owner can check Bluetooth bridge health.", 403);
    }

    const body = (await req.json()) as BluetoothHealthPayload;
    const bridgeUrl =
      normalizeText(body.bridge_url) ??
      readEnv("PRINT_BLUETOOTH_BRIDGE_URL") ??
      readEnv("PRINT_BRIDGE_URL") ??
      null;

    if (!bridgeUrl) {
      return fail("bridge_url_required", "bridge_url is required or set PRINT_BLUETOOTH_BRIDGE_URL.", 422);
    }

    const timeoutMs = resolveBridgeTimeoutMs({ timeout_ms: body.timeout_ms ?? null }, "PRINT_BLUETOOTH_BRIDGE_TIMEOUT_MS", 8000);
    const startedAt = Date.now();
    const response = await fetchBridgeWithTimeout(bridgeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "health",
        transport: "bluetooth",
        timeout_ms: timeoutMs,
        metadata: {
          request_source: "backoffice_printer_settings",
          health_check: true
        }
      })
    }, timeoutMs);
    const latencyMs = Date.now() - startedAt;
    const rawText = await response.text();
    const bridgePayload = parseBridgePayload(rawText);

    if (!response.ok) {
      return ok(
        buildBridgeEnvelope({
          ok: false,
          code: "bridge_unhealthy",
          message: `Bridge health request failed (${response.status}).`,
          action: "health",
          data: {
            bridge_url: bridgeUrl,
            timeout_ms: timeoutMs,
            latency_ms: latencyMs,
            bridge_response: bridgePayload
          }
        })
      );
    }

    return ok(
      buildBridgeEnvelope({
        ok: true,
        code: "bridge_healthy",
        message: "Bridge is reachable.",
        action: "health",
        data: {
          bridge_url: bridgeUrl,
          timeout_ms: timeoutMs,
          latency_ms: latencyMs,
          bridge_response: bridgePayload
        }
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return ok(
      buildBridgeEnvelope({
        ok: false,
        code: "bridge_unreachable",
        message,
        action: "health",
        data: {
          bridge_url: null,
          latency_ms: null,
          bridge_response: {}
        }
      })
    );
  }
}
