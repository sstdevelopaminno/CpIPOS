"use client";

import { useEffect, useRef } from "react";
import {
  buildHeartbeatPayload,
  executePendingActions,
  resolveMachineId,
  sendDeviceHeartbeat,
  type DeviceHeartbeatReason
} from "@/lib/device-heartbeat-client";

const STARTUP_DELAY_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const HEARTBEAT_MIN_GAP_MS = 60_000;

export function MobileDeviceHeartbeatSender({ deviceCode }: { deviceCode: string }) {
  const inFlightRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const startedAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const machineId = resolveMachineId();

    async function send(reason: DeviceHeartbeatReason) {
      if (cancelled || inFlightRef.current) return;
      const now = Date.now();
      if (reason !== "startup" && now - lastSentAtRef.current < HEARTBEAT_MIN_GAP_MS) return;

      inFlightRef.current = true;
      try {
        const payload = buildHeartbeatPayload({ deviceCode, machineId, startedAt: startedAtRef.current, reason });
        const pendingActions = await sendDeviceHeartbeat(payload);
        lastSentAtRef.current = Date.now();
        if (!cancelled && pendingActions.length > 0) {
          executePendingActions(pendingActions);
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    startedAtRef.current = Date.now();
    const startupTimer = window.setTimeout(() => void send("startup"), STARTUP_DELAY_MS);
    const intervalTimer = window.setInterval(() => void send("interval"), HEARTBEAT_INTERVAL_MS);

    function handleOnline() {
      void send("online");
    }
    function handleOffline() {
      void send("offline");
    }
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") void send("visible");
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearTimeout(startupTimer);
      window.clearInterval(intervalTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [deviceCode]);

  return null;
}
