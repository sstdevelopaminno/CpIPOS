"use client";

import { useEffect, useRef } from "react";
import { withWindowsAgentDeadline } from "@/lib/printing/windows-agent-request";
import { acknowledgeDeviceCommands } from "@/lib/pos/device-command-ack-client";
import {
  buildHeartbeatPayload,
  detectSurface,
  executePendingActions,
  resolveDeviceCode,
  resolveMachineId,
  sendDeviceHeartbeat,
  type DeviceHeartbeatReason
} from "@/lib/pos/device-heartbeat-client";

type SessionCurrentResponse = {
  data?: {
    device?: { code?: string | null } | null;
  } | null;
};

const STARTUP_DELAY_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
// The Windows print API requires a device-health snapshot younger than 180s.
// Leave 60s of slack without changing the Android/browser heartbeat cadence.
const WINDOWS_HEARTBEAT_INTERVAL_MS = 120_000;
const HEARTBEAT_MIN_GAP_MS = 60_000;

async function loadSessionDeviceCode(windows: boolean): Promise<string | null> {
  try {
    const load = async (signal?: AbortSignal) => {
      const response = await fetch("/api/pos/session/current", { cache: "no-store", credentials: "include", signal });
      if (!response.ok) return null;
      const body = (await response.json()) as SessionCurrentResponse;
      return body.data?.device?.code ?? null;
    };
    return windows ? await withWindowsAgentDeadline(load) : await load();
  } catch {
    return null;
  }
}

export function PosDeviceHeartbeatSender() {
  const inFlightRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const startedAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let deviceCode = "POS-DEVICE";
    let machineId = "";
    let initialized = false;
    let lastWindowsRecoveryAt = 0;
    const surface = detectSurface();
    startedAtRef.current = Date.now();

    async function send(reason: DeviceHeartbeatReason) {
      if (cancelled || !initialized || inFlightRef.current) return;
      const now = Date.now();
      if (reason !== "startup" && reason !== "command" && now - lastSentAtRef.current < HEARTBEAT_MIN_GAP_MS) return;

      let followUpSnapshot = false;
      inFlightRef.current = true;
      try {
        const payload = await buildHeartbeatPayload({
          surface,
          deviceCode,
          machineId,
          startedAt: startedAtRef.current,
          reason
        });
        if (!cancelled) {
          const pendingActions = await sendDeviceHeartbeat(payload);
          lastSentAtRef.current = Date.now();
          if (pendingActions.length > 0) {
            // Reload commands must be acknowledged before execution because the
            // navigation would otherwise terminate the acknowledgement request.
            const reloadActions = pendingActions.filter(
              (action) => action.command_type === "reload_ui" || action.command_type === "restart_app"
            );
            const executableWithoutReload = pendingActions.filter(
              (action) => action.command_type !== "reload_ui" && action.command_type !== "restart_app"
            );

            if (executableWithoutReload.length > 0) {
              const results = await executePendingActions(executableWithoutReload);
              await acknowledgeDeviceCommands(results, surface, payload.identity.app_version ?? null);
              followUpSnapshot = executableWithoutReload.some((action) =>
                action.command_type === "request_diagnostics" ||
                action.command_type === "request_diagnostics_bundle" ||
                action.command_type === "test_printer" ||
                  action.command_type === "set_printer"
              );
            }

            if (reloadActions.length > 0) {
              await acknowledgeDeviceCommands(
                reloadActions.map((action) => ({
                  id: action.id,
                  command_type: action.command_type,
                  applied: true,
                  phase: "accepted" as const
                })),
                surface,
                payload.identity.app_version ?? null
              );
              await executePendingActions(reloadActions);
            }
          }
        }
      } catch (error) {
        if (!cancelled) console.warn("[pos-device-heartbeat] snapshot unavailable", error instanceof Error ? error.name : "unknown");
      } finally {
        inFlightRef.current = false;
      }

      if (followUpSnapshot && !cancelled) {
        window.setTimeout(() => void send("command"), 750);
      }
    }

    let startupTimer: number | undefined;
    let intervalTimer: number | undefined;

    async function init() {
      machineId = resolveMachineId(surface);
      const sessionDeviceCode = await loadSessionDeviceCode(surface === "windows_runtime");
      if (cancelled) return;
      deviceCode = resolveDeviceCode(surface, sessionDeviceCode);
      initialized = true;

      startupTimer = window.setTimeout(() => void send("startup"), STARTUP_DELAY_MS);
      intervalTimer = window.setInterval(() => void send("interval"),
        surface === "windows_runtime" ? WINDOWS_HEARTBEAT_INTERVAL_MS : HEARTBEAT_INTERVAL_MS);
    }

    function handleOnline() {
      void send("online");
    }

    function handleOffline() {
      void send("offline");
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void send("visible");
    }

    // Only an authenticated Windows print request that hit the existing health
    // gate can ask for a fresh snapshot. Bound recovery to once per minute;
    // reuse the same in-flight sender and never invent printer validity.
    function handleWindowsPrintHealthRecovery() {
      if (surface !== "windows_runtime" || cancelled || !initialized || inFlightRef.current) return;
      const now = Date.now();
      if (now - lastWindowsRecoveryAt < HEARTBEAT_MIN_GAP_MS) return;
      lastWindowsRecoveryAt = now;
      void send("command");
    }

    void init();
    window.addEventListener("cpi-windows-print-health-recovery", handleWindowsPrintHealthRecovery);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (startupTimer !== undefined) window.clearTimeout(startupTimer);
      if (intervalTimer !== undefined) window.clearInterval(intervalTimer);
      window.removeEventListener("cpi-windows-print-health-recovery", handleWindowsPrintHealthRecovery);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
