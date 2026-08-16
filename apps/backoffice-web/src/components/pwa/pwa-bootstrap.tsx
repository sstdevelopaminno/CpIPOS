"use client";

import { useEffect, useState } from "react";

const ACTIVE_POS_STORAGE_KEYS = [
  "pos_pending_submit_v012",
  "pos_pending_submit_queue_v001",
  "pos_pending_payment_queue_v001",
  "pos_active_order_v001",
  "pos_dine_in_selected_table_v001"
] as const;

function hasNonEmptyArray(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.length > 0 : Boolean(parsed);
  } catch {
    return true;
  }
}

function isSafeForAutomaticUiRefresh(): boolean {
  try {
    if (hasNonEmptyArray(window.localStorage.getItem("pos_sales_cart_v012"))) return false;
    return !ACTIVE_POS_STORAGE_KEYS.some((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) return false;
      if (key.includes("queue")) return hasNonEmptyArray(raw);
      const normalized = raw.trim();
      return normalized.length > 0 && normalized !== "null" && normalized !== "{}" && normalized !== "[]";
    });
  } catch {
    // Never force a reload when POS state cannot be proven idle.
    return false;
  }
}

export function PwaBootstrap() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
            await Promise.all(keys.map((key) => window.caches.delete(key)));
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

    let reloadedForUpdate = false;
    const handleControllerChange = () => {
      if (reloadedForUpdate) return;
      reloadedForUpdate = true;
      window.location.reload();
    };

    const activateOrOfferUpdate = (worker: ServiceWorker) => {
      if (isSafeForAutomaticUiRefresh()) {
        setIsRefreshing(true);
        worker.postMessage({ type: "SKIP_WAITING" });
        return;
      }
      setWaitingWorker(worker);
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (registration.waiting) {
          activateOrOfferUpdate(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const nextWorker = registration.installing;
          if (!nextWorker) return;

          nextWorker.addEventListener("statechange", () => {
            if (nextWorker.state === "installed" && navigator.serviceWorker.controller) {
              activateOrOfferUpdate(nextWorker);
            }
          });
        });

        await registration.update();
      } catch {
        // PWA update checks should never block login/POS usage.
      }
    })();

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

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
        ระบบจะอัปเดตอัตโนมัติเมื่อไม่มีบิล/ตะกร้า/งานค้าง หรือกดอัปเดตเมื่อพร้อม
      </div>
      <button
        type="button"
        onClick={() => {
          setIsRefreshing(true);
          waitingWorker.postMessage({ type: "SKIP_WAITING" });
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
