import { NextResponse } from "next/server";

const SAFE_MDM_COMMANDS = new Set([
  "ping",
  "collect_diagnostics",
  "reload_webview",
  "navigate_home",
  "clear_webview_cache",
  "clear_cookies",
  "clear_webview_data",
  "test_printer_connection"
]);

// Bump this value once, at the end of a completed product-change batch.
// Android POS heartbeats only receive reload_webview when their last recorded
// reload is older than this generation, preventing a 60-second reload loop.
const MDM_RELOAD_GENERATION_MS = 1786429494893;

type AndroidPosMdmCommand = {
  id?: string;
  action?: string;
  reason?: string;
};

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "X-CpIPOS-MDM-Lite": "android-pos"
  };
}

function parseSafeCommandsFromEnv(): AndroidPosMdmCommand[] {
  const raw = process.env.CPIPOS_ANDROID_POS_MDM_COMMANDS_JSON?.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((value): AndroidPosMdmCommand | null => {
        if (!value || typeof value !== "object") return null;
        const row = value as Record<string, unknown>;
        const action = String(row.action ?? "").trim().toLowerCase();
        if (!SAFE_MDM_COMMANDS.has(action)) return null;
        return {
          id: String(row.id ?? `env-${action}`).slice(0, 80),
          action,
          reason: String(row.reason ?? "env_control").slice(0, 160)
        };
      })
      .filter((value): value is AndroidPosMdmCommand => Boolean(value))
      .slice(0, 5);
  } catch {
    return [];
  }
}

function getLastReloadAtMs(payload: Record<string, unknown> | null): number {
  const rawLastCommand = payload?.last_command;
  if (!rawLastCommand || typeof rawLastCommand !== "object" || Array.isArray(rawLastCommand)) {
    return 0;
  }

  const lastCommand = rawLastCommand as Record<string, unknown>;
  const action = String(lastCommand.action ?? "").trim().toLowerCase();
  if (action !== "reload_webview") return 0;

  const atMs = Number(lastCommand.at_ms ?? 0);
  return Number.isFinite(atMs) && atMs > 0 ? atMs : 0;
}

function buildHeartbeatCommands(payload: Record<string, unknown> | null): AndroidPosMdmCommand[] {
  const envCommands = parseSafeCommandsFromEnv();

  // reload_webview is controlled by the one-time generation below rather than
  // a persistent env command, because the Android agent polls every 60 seconds.
  const nonReloadEnvCommands = envCommands.filter((command) => command.action !== "reload_webview");
  const lastReloadAtMs = getLastReloadAtMs(payload);

  if (lastReloadAtMs >= MDM_RELOAD_GENERATION_MS) {
    return nonReloadEnvCommands.slice(0, 5);
  }

  return [
    ...nonReloadEnvCommands,
    {
      id: `deploy-reload-${MDM_RELOAD_GENERATION_MS}`,
      action: "reload_webview",
      reason: "post_deploy_refresh"
    }
  ].slice(0, 5);
}

export async function GET() {
  return NextResponse.json(
    {
      data: {
        ok: true,
        service: "android-pos-mdm-lite-heartbeat",
        safe_commands: Array.from(SAFE_MDM_COMMANDS),
        reload_generation_ms: MDM_RELOAD_GENERATION_MS,
        commands: []
      },
      error: null
    },
    { headers: noStoreHeaders() }
  );
}

export async function POST(request: Request) {
  const installId = String(request.headers.get("x-cpipos-install-id") ?? "").trim().slice(0, 120) || null;
  const appVersion = String(request.headers.get("x-cpipos-app-version") ?? "").trim().slice(0, 40) || null;
  const isAndroidPos = request.headers.get("x-cpipos-android-pos") === "true";
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  // This endpoint stays app-scoped and low-risk. It accepts diagnostics and
  // returns only allowlisted commands; it does not mutate tenant business data.
  const commands = isAndroidPos ? buildHeartbeatCommands(payload) : [];

  if (commands.some((command) => command.action === "reload_webview")) {
    console.info("[android-pos-mdm] one-time reload issued", {
      install_id_suffix: installId?.slice(-8) ?? null,
      app_version: appVersion,
      generation_ms: MDM_RELOAD_GENERATION_MS
    });
  }

  return NextResponse.json(
    {
      data: {
        ok: true,
        accepted_at: new Date().toISOString(),
        service: "android-pos-mdm-lite-heartbeat",
        install_id: installId,
        app_version: appVersion,
        payload_received: Boolean(payload),
        reload_generation_ms: MDM_RELOAD_GENERATION_MS,
        commands
      },
      error: null
    },
    { headers: noStoreHeaders() }
  );
}
