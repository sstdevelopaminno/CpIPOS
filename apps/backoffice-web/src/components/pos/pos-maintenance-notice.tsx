"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const BANGKOK_TIME_ZONE = "Asia/Bangkok";
const REPEAT_INTERVAL_MS = 60 * 60 * 1000;
const AUTO_HIDE_MS = 15 * 1000;
const CHECK_INTERVAL_MS = 30 * 1000;
const LAST_SHOWN_STORAGE_KEY = "cpipos:pos-maintenance-notice:last-shown-at";

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
  const isPos = pathname === "/pos" || pathname.startsWith("/pos/") || pathname === "/preview/pos" || pathname.startsWith("/preview/pos/");
  const isCustomerDisplay = pathname.startsWith("/pos/customer-display") || pathname.startsWith("/preview/pos/customer-display");
  return isPos && !isCustomerDisplay;
}

export function PosMaintenanceNotice() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isPosPath(pathname)) {
      setVisible(false);
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
      setVisible(false);
    };

    const check = () => {
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
        // Storage can be unavailable in restricted WebViews; the notice still works for this page session.
      }

      clearHideTimer();
      setVisible(true);
      hideTimerRef.current = setTimeout(() => {
        setVisible(false);
        hideTimerRef.current = null;
      }, AUTO_HIDE_MS);
    };

    check();
    const intervalId = window.setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      clearHideTimer();
    };
  }, [pathname]);

  if (!isPosPath(pathname)) return null;

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 top-0 z-[220] flex justify-center px-3 pt-3 transition-all duration-500 ease-out ${
        visible ? "translate-y-0 opacity-100" : "-translate-y-full opacity-0"
      }`}
      aria-hidden={!visible}
    >
      <div
        className="pointer-events-auto flex w-full max-w-5xl items-start gap-3 rounded-2xl border border-amber-300 bg-amber-100 px-4 py-3 text-amber-950 shadow-lg shadow-amber-950/10"
        role="status"
        aria-live="polite"
      >
        <span className="mt-0.5 text-lg" aria-hidden="true">⚠️</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black sm:text-base">แจ้งปรับปรุงระบบชั่วคราว เวลา 23:00–04:00 น.</p>
          <p className="mt-0.5 text-xs font-semibold leading-5 sm:text-sm">
            ท่านยังสามารถขายสินค้าและใช้งานระบบได้ตามปกติ แต่อาจพบความล่าช้าหรือผลกระทบเล็กน้อยในบางช่วงเวลา บริษัทฯ ขออภัยในความไม่สะดวก
          </p>
        </div>
        <button
          type="button"
          className="-mr-1 -mt-1 rounded-lg px-2 py-1 text-lg font-black leading-none text-amber-900 hover:bg-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-600"
          aria-label="ปิดข้อความแจ้งเตือน"
          onClick={() => setVisible(false)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
