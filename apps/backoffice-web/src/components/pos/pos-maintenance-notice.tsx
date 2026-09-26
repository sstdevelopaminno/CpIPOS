"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const BANGKOK_TIME_ZONE = "Asia/Bangkok";
const REPEAT_INTERVAL_MS = 60 * 60 * 1000;
const AUTO_HIDE_MS = 15 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;
const BROADCAST_REFRESH_MS = 120 * 1000;
const LAST_SHOWN_STORAGE_KEY = "cpipos:pos-maintenance-notice:last-shown-at";
const BROADCAST_API_BASE =
  process.env.NEXT_PUBLIC_CPIPOS_IT_PUBLIC_URL ?? "https://cp-ipos-it-web.vercel.app";

type Broadcast = {
  id: string;
  severity: "info" | "warning" | "danger" | "emergency";
  title_th: string;
  title_en: string;
  message_th: string;
  message_en: string;
  action_label_th: string;
  action_label_en: string;
  action_url: string | null;
  bar_color: string;
  text_color: string;
  button_color: string;
  button_text_color: string;
  dismissible: boolean;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
};

function getBangkokHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BANGKOK_TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? -1);
  return Number.isFinite(hour) ? hour : -1;
}

function isMaintenanceWindow(date = new Date()) {
  const hour = getBangkokHour(date);
  return hour >= 23 || (hour >= 0 && hour < 4);
}

function isPosPath(pathname: string) {
  const isPos =
    pathname === "/pos" ||
    pathname.startsWith("/pos/") ||
    pathname === "/preview/pos" ||
    pathname.startsWith("/preview/pos/");
  const isCustomerDisplay =
    pathname.startsWith("/pos/customer-display") ||
    pathname.startsWith("/preview/pos/customer-display");
  return isPos && !isCustomerDisplay;
}

function dismissedBroadcastKey(updatedAt: string) {
  return `cpipos:emergency-broadcast:dismissed:${updatedAt}`;
}

export function PosMaintenanceNotice() {
  const pathname = usePathname();
  const [maintenanceVisible, setMaintenanceVisible] = useState(false);
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [broadcastDismissed, setBroadcastDismissed] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const broadcastRequestRef = useRef<Promise<void> | null>(null);

  const loadBroadcast = useCallback(() => {
    if (!isPosPath(pathname)) return Promise.resolve();
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return Promise.resolve();
    if (broadcastRequestRef.current) return broadcastRequestRef.current;

    let requestPromise: Promise<void>;
    requestPromise = (async () => {
      try {
        const response = await fetch(
          `${BROADCAST_API_BASE.replace(/\/$/, "")}/api/public/emergency-broadcast?target=pos`,
          { cache: "no-store", credentials: "omit" }
        );
        if (!response.ok) return;

        const payload = await response.json();
        const next = (payload?.data?.broadcast ?? null) as Broadcast | null;
        setBroadcast(next);

        if (!next?.updated_at) {
          setBroadcastDismissed(false);
          return;
        }

        try {
          setBroadcastDismissed(
            window.localStorage.getItem(dismissedBroadcastKey(next.updated_at)) === next.updated_at
          );
        } catch {
          setBroadcastDismissed(false);
        }
      } catch {
        // The existing POS maintenance notice remains available if the control plane is unreachable.
      } finally {
        if (broadcastRequestRef.current === requestPromise) {
          broadcastRequestRef.current = null;
        }
      }
    })();

    broadcastRequestRef.current = requestPromise;
    return requestPromise;
  }, [pathname]);

  useEffect(() => {
    if (!isPosPath(pathname)) {
      setBroadcast(null);
      setBroadcastDismissed(false);
      return;
    }

    const initialId = window.setTimeout(() => void loadBroadcast(), 0);
    const intervalId = window.setInterval(() => void loadBroadcast(), BROADCAST_REFRESH_MS);
    const onFocus = () => void loadBroadcast();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadBroadcast();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearTimeout(initialId);
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadBroadcast, pathname]);

  useEffect(() => {
    if (!isPosPath(pathname)) {
      setMaintenanceVisible(false);
      return;
    }

    const clearHideTimer = () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };

    const hide = () => {
      clearHideTimer();
      setMaintenanceVisible(false);
    };

    const check = () => {
      if (broadcast && !broadcastDismissed) {
        hide();
        return;
      }

      const now = new Date();
      if (!isMaintenanceWindow(now)) {
        hide();
        return;
      }

      let lastShownAt = 0;
      try {
        lastShownAt = Number(window.localStorage.getItem(LAST_SHOWN_STORAGE_KEY) ?? 0);
      } catch {
        lastShownAt = 0;
      }

      if (lastShownAt > 0 && now.getTime() - lastShownAt < REPEAT_INTERVAL_MS) return;

      try {
        window.localStorage.setItem(LAST_SHOWN_STORAGE_KEY, String(now.getTime()));
      } catch {
        // Storage can be unavailable in restricted WebViews.
      }

      clearHideTimer();
      setMaintenanceVisible(true);
      hideTimerRef.current = setTimeout(() => {
        setMaintenanceVisible(false);
        hideTimerRef.current = null;
      }, AUTO_HIDE_MS);
    };

    check();
    const intervalId = window.setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      clearHideTimer();
    };
  }, [pathname, broadcast, broadcastDismissed]);

  if (!isPosPath(pathname)) return null;

  const emergencyVisible = Boolean(broadcast && !broadcastDismissed);
  const visible = emergencyVisible || maintenanceVisible;
  const title = emergencyVisible
    ? broadcast?.title_th || broadcast?.title_en || "แจ้งเตือนฉุกเฉิน"
    : "แจ้งปรับปรุงระบบชั่วคราว เวลา 23:00–04:00 น.";
  const message = emergencyVisible
    ? broadcast?.message_th || broadcast?.message_en || ""
    : "ท่านยังสามารถขายสินค้าและใช้งานระบบได้ตามปกติ แต่อาจพบความล่าช้าหรือผลกระทบเล็กน้อยในบางช่วงเวลา บริษัทฯ ขออภัยในความไม่สะดวก";

  const dismissEmergency = () => {
    if (!broadcast?.updated_at) return;
    try {
      window.localStorage.setItem(
        dismissedBroadcastKey(broadcast.updated_at),
        broadcast.updated_at
      );
    } catch {
      // Keep this-session dismissal even if storage is unavailable.
    }
    setBroadcastDismissed(true);
  };

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 top-0 z-[220] flex justify-center px-3 pt-3 transition-all duration-500 ease-out ${
        visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
      }`}
      aria-hidden={!visible}
    >
      <div
        className={`pointer-events-auto flex w-full max-w-5xl items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg ${
          emergencyVisible
            ? "border-black/10"
            : "border-amber-300 bg-amber-100 text-amber-950 shadow-amber-950/10"
        }`}
        style={
          emergencyVisible && broadcast
            ? {
                backgroundColor: broadcast.bar_color,
                color: broadcast.text_color,
                boxShadow: "0 10px 28px rgba(15,23,42,.16)",
              }
            : undefined
        }
        role="alert"
        aria-live={emergencyVisible ? "assertive" : "polite"}
      >
        <span className="mt-0.5 text-lg" aria-hidden="true">⚠️</span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-black sm:text-base">{title}</p>
          <p className="mt-0.5 text-xs font-semibold leading-5 sm:text-sm">{message}</p>
        </div>

        {emergencyVisible && broadcast?.action_url && (broadcast.action_label_th || broadcast.action_label_en) ? (
          <a
            href={broadcast.action_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 shrink-0 rounded-lg px-3 py-2 text-xs font-black shadow-sm"
            style={{
              backgroundColor: broadcast.button_color,
              color: broadcast.button_text_color,
            }}
          >
            {broadcast.action_label_th || broadcast.action_label_en}
          </a>
        ) : null}

        <button
          type="button"
          className="-mr-1 -mt-1 rounded-lg px-2 py-1 text-lg font-black leading-none hover:bg-black/10 focus:outline-none focus:ring-2 focus:ring-current"
          aria-label="ปิดข้อความแจ้งเตือน"
          onClick={emergencyVisible ? dismissEmergency : () => setMaintenanceVisible(false)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
