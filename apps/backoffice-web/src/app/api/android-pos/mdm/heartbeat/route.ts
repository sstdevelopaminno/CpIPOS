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

export async function GET() {
  return NextResponse.json(
    {
      data: {
        ok: true,
        service: "android-pos-mdm-lite-heartbeat",
        safe_commands: Array.from(SAFE_MDM_COMMANDS),
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

  // This endpoint is deliberately low-risk for the first MDM-lite build:
  // it accepts diagnostics and returns only allowlisted app-level commands.
  // It does not execute server-side actions, mutate tenant data, or expose secrets.
  const commands = isAndroidPos ? parseSafeCommandsFromEnv() : [];

  return NextResponse.json(
    {
      data: {
        ok: true,
        accepted_at: new Date().toISOString(),
        service: "android-pos-mdm-lite-heartbeat",
        install_id: installId,
        app_version: appVersion,
        payload_received: Boolean(payload),
        commands
      },
      error: null
    },
    { headers: noStoreHeaders() }
  );
}
