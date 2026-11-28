"use client";

import { useEffect, useState } from "react";

import { isSafeForAppUpdate } from "@/lib/app-update-safety";

const UPDATE_CHECK_MS = 5 * 60_000;

export function PwaBootstrap() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [updateRequested, setUpdateRequested] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void (async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));
          if ("caches" in window) {
            const keys = await window.caches.keys();
            await Promise.all(keys.filter((key) => key.startsWith("cpipos-shell-")).map((key) => window.caches.delete(key)));
          }
          if (navigator.serviceWorker.controller && !window.sessionStorage.getItem("cpipos_dev_sw_cleared_v1")) {
            window.sessionStorage.setItem("cpipos_dev_sw_cleared_v1", "1");
            window.location.reload();
          }
        } catch {
          // Local PWA cleanup must not block development.
        }
      })();
      return;
    }

    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let checking = false;
    let lastCheck = 0;
    const check = async () => {
      if (!registration || disposed || checking || !navigator.onLine ||
          document.visibilityState !== "visible") return;
      if (Date.now() - lastCheck < 15_000) return;
      checking = true;
      lastCheck = Date.now();
      try {
        await registration.update();
        if (!disposed && registration.waiting) setWaitingWorker(registration.waiting);
      } catch {
        // Retry on focus, reconnect or the next periodic check.
      } finally {
        checking = false;
      }
    };

    const watchUpdate = () => {
      const nextWorker = registration?.installing;
      if (!nextWorker) return;
      nextWorker.addEventListener("statechange", () => {
        if (!disposed && nextWorker.state === "installed" && navigator.serviceWorker.controller) {
          setWaitingWorker(nextWorker);
        }
      });
    };

    void (async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        if (disposed) return;
        if (registration.waiting) setWaitingWorker(registration.waiting);
        registration.addEventListener("updatefound", watchUpdate);
        watchUpdate();
        await check();
      } catch {
        // An unavailable service worker must not block login/POS usage.
      }
    })();
    const timer = window.setInterval(() => void check(), UPDATE_CHECK_MS);
    const onWake = () => void check();
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      registration?.removeEventListener("updatefound", watchUpdate);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, []);

  useEffect(() => {
    if (!updateRequested) return;
    let disposed = false;
    // Only the tab that explicitly requested activation may reload.
    const onControllerChange = async () => {
      const safe = await isSafeForAppUpdate();
      if (disposed) return;
      if (safe) window.location.reload();
      else {
        setBlocked(true);
        setIsRefreshing(false);
        setUpdateRequested(false);
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    // A waiting worker may already have activated in another tab.
    if (waitingWorker?.state === "activated") void onControllerChange();
    else waitingWorker?.postMessage({ type: "SKIP_WAITING" });
    const timeout = window.setTimeout(() => {
      setIsRefreshing(false);
      setUpdateRequested(false);
    }, 20_000);
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, [updateRequested, waitingWorker]);

  if (!waitingWorker) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 10000,
        maxWidth: 360,
        borderRadius: 12,
        border: "1px solid rgba(14, 165, 233, 0.28)",
        background: "rgba(5, 14, 28, 0.96)",
        boxShadow: "0 18px 48px rgba(2, 8, 23, 0.35)",
        color: "#f8fafc",
        padding: 14,
        fontFamily: "var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)"
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700 }}>มีอัปเดต CpIPOS พร้อมใช้งาน</div>
      <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: "#cbd5e1" }}>
        ระบบตรวจหาอัปเดตอัตโนมัติ กรุณาปิดงานขาย ซิงก์ข้อมูลค้าง และกลับหน้าเข้าสู่ระบบก่อนอัปเดต
      </div>
      {blocked ? <div role="alert" style={{ marginTop: 8, color: "#fbbf24", fontSize: 12 }}>ยังมีงานค้างหรือไม่สามารถยืนยันสถานะข้อมูลได้ กรุณาซิงก์/ตรวจสอบก่อนอัปเดต</div> : null}
      <button
        type="button"
        onClick={async () => {
          setIsRefreshing(true);
          const safe = await isSafeForAppUpdate();
          setBlocked(!safe);
          if (!safe) {
            setIsRefreshing(false);
            return;
          }
          setUpdateRequested(true);
        }}
        disabled={isRefreshing}
        style={{
          marginTop: 10,
          minHeight: 36,
          width: "100%",
          border: 0,
          borderRadius: 8,
          background: isRefreshing ? "#64748b" : "#0ea5e9",
          color: "#ffffff",
          cursor: isRefreshing ? "default" : "pointer",
          fontSize: 13,
          fontWeight: 700
        }}
      >
        {isRefreshing ? "กำลังอัปเดต..." : "อัปเดตระบบ"}
      </button>
    </div>
  );
}
