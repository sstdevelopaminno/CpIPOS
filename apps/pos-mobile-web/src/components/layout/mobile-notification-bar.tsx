"use client";

import { Bell, RefreshCcw, WifiOff, X } from "lucide-react";
import { useEffect, useState } from "react";

const NOTICE_STORAGE_KEY = "sstipos_mobile_notice_version";

type Notice = {
  title: string;
  message: string;
  tone: "info" | "warning" | "success";
  action?: "reload" | "permission";
};

type PushKeyResponse = {
  data?: { enabled?: boolean; publicKey?: string | null };
};

type VersionResponse = {
  data?: { version?: string | null; environment?: string | null };
};

function canUseSystemNotifications() {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }
  return output;
}

async function showSystemNotification(title: string, message: string) {
  if (!canUseSystemNotifications() || Notification.permission !== "granted") return;
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body: message,
      icon: "/brand/cpipos-icon-transparent-192.png",
      badge: "/brand/cpipos-icon-transparent-192.png",
      tag: `sstipos-mobile-notice-${Date.now()}`,
    });
  } catch {
    // The in-app banner remains available when the OS notification channel is blocked.
  }
}

async function subscribeToPush(publicKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const response = await fetch("/api/mobile/notifications/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription }),
  });

  return response.ok;
}

export function MobileNotificationBar() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);

  useEffect(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setStandalone(isStandalone);

    async function registerServiceWorker() {
      if (!("serviceWorker" in navigator)) return;
      const registration = await navigator.serviceWorker.register("/sw.js").catch(() => null);
      if (registration?.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });

      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "SSTIPOS_SW_READY") {
          window.dispatchEvent(new CustomEvent("sstipos:notify", {
            detail: { title: "PWA พร้อมใช้งาน", message: "ระบบแจ้งเตือนพร้อมทำงานบนมือถือแล้ว", tone: "success" },
          }));
        }
        if (event.data?.type === "SSTIPOS_PUSH_NOTICE") {
          window.dispatchEvent(new CustomEvent("sstipos:notify", {
            detail: { title: event.data.title, message: event.data.message, tone: "success" },
          }));
        }
      });
    }

    async function setupPush() {
      if (!canUseSystemNotifications()) return;
      const response = await fetch("/api/mobile/notifications/vapid-public-key", { cache: "no-store" }).catch(() => null);
      const json = response ? await response.json().catch(() => null) as PushKeyResponse | null : null;
      const publicKey = json?.data?.enabled ? json.data.publicKey : null;
      if (!publicKey) return;
      setPushPublicKey(publicKey);

      if (Notification.permission === "default") {
        setNotice({
          title: "เปิดแจ้งเตือนมือถือ",
          message: "กดเปิดเพื่อรับแจ้งเตือนหลังอัปเดต แม้ปิดแอปอยู่",
          tone: "info",
          action: "permission",
        });
      } else if (Notification.permission === "granted") {
        void subscribeToPush(publicKey);
      }
    }

    async function checkDeployedVersion() {
      const response = await fetch("/api/system/version", { cache: "no-store" }).catch(() => null);
      const json = response ? await response.json().catch(() => null) as VersionResponse | null : null;
      const version = json?.data?.version;
      if (!version || version === "local") return;

      const previousVersion = localStorage.getItem(NOTICE_STORAGE_KEY);
      if (previousVersion === version) return;
      localStorage.setItem(NOTICE_STORAGE_KEY, version);

      const updateNotice: Notice = {
        title: "CpIPOS Mobile อัปเดตแล้ว",
        message: `ระบบอัปเดตเวอร์ชัน ${version} พร้อมใช้งาน`,
        tone: "success",
        action: "reload",
      };
      setNotice(updateNotice);
      void showSystemNotification(updateNotice.title, updateNotice.message);
    }

    void registerServiceWorker();
    void setupPush();
    void checkDeployedVersion();

    const handleOffline = () => setNotice({ title: "ออฟไลน์", message: "อินเทอร์เน็ตหลุด ระบบอาจตอบสนองช้า", tone: "warning" });
    const handleOnline = () => setNotice({ title: "ออนไลน์แล้ว", message: "เชื่อมต่ออินเทอร์เน็ตกลับมาแล้ว", tone: "success" });
    const handleCustomNotice = (event: Event) => {
      const detail = (event as CustomEvent<Partial<Notice>>).detail;
      if (!detail?.title || !detail?.message) return;
      setNotice({
        title: detail.title,
        message: detail.message,
        tone: detail.tone ?? "info",
        action: detail.action,
      });
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener("sstipos:notify", handleCustomNotice);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("sstipos:notify", handleCustomNotice);
    };
  }, []);

  if (!notice) return null;

  const colors = notice.tone === "warning"
    ? { border: "#fed7aa", bg: "#fff7ed", icon: "#f97316", text: "#7c2d12" }
    : notice.tone === "success"
      ? { border: "#bbf7d0", bg: "#f0fdf4", icon: "#16a34a", text: "#14532d" }
      : { border: "#bfdbfe", bg: "#eff6ff", icon: "#1677d9", text: "#0f2745" };

  async function enablePush() {
    if (!pushPublicKey) return;
    const subscribed = await subscribeToPush(pushPublicKey).catch(() => false);
    setNotice(subscribed
      ? { title: "เปิดแจ้งเตือนแล้ว", message: "ระบบจะส่งแจ้งเตือนผ่านมือถือเมื่อมีอัปเดตใหม่", tone: "success" }
      : { title: "เปิดแจ้งเตือนไม่สำเร็จ", message: "ตรวจสอบสิทธิ์แจ้งเตือนของ Chrome หรือการติดตั้ง PWA", tone: "warning" });
  }

  return (
    <div style={{ position: "fixed", top: "max(8px, env(safe-area-inset-top))", left: "50%", zIndex: 120, width: "min(420px, calc(100vw - 20px))", transform: "translateX(-50%)", pointerEvents: "none" }}>
      <div style={{ display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 10, alignItems: "center", border: `1px solid ${colors.border}`, borderRadius: 14, background: colors.bg, padding: "10px 10px 10px 12px", color: colors.text, boxShadow: "0 16px 40px rgba(15,39,69,0.18)", pointerEvents: "auto" }}>
        <span style={{ display: "flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 999, background: "#fff", color: colors.icon }}>
          {notice.tone === "warning" ? <WifiOff size={16} /> : <Bell size={16} />}
        </span>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: "block", overflow: "hidden", fontSize: 13, fontWeight: 950, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{notice.title}</strong>
          <span style={{ display: "block", marginTop: 2, fontSize: 11, fontWeight: 800, lineHeight: 1.35 }}>{notice.message}</span>
          {!standalone ? <span style={{ display: "block", marginTop: 3, fontSize: 10, fontWeight: 800, opacity: 0.75 }}>ถ้าเห็นแถบ URL ให้เปิดจากไอคอนที่ติดตั้งบนหน้าจอมือถือ</span> : null}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {notice.action === "reload" ? (
            <button type="button" onClick={() => window.location.reload()} aria-label="โหลดใหม่" style={{ display: "flex", width: 34, height: 34, minHeight: 34, alignItems: "center", justifyContent: "center", border: `1px solid ${colors.border}`, borderRadius: 999, background: "#fff", color: colors.icon }}>
              <RefreshCcw size={15} />
            </button>
          ) : null}
          {notice.action === "permission" && canUseSystemNotifications() ? (
            <button type="button" onClick={() => void enablePush()} style={{ minHeight: 34, border: `1px solid ${colors.border}`, borderRadius: 999, background: "#fff", color: colors.icon, padding: "0 10px", fontSize: 11, fontWeight: 900 }}>
              เปิด
            </button>
          ) : null}
          <button type="button" onClick={() => setNotice(null)} aria-label="ปิดแจ้งเตือน" style={{ display: "flex", width: 34, height: 34, minHeight: 34, alignItems: "center", justifyContent: "center", border: `1px solid ${colors.border}`, borderRadius: 999, background: "#fff", color: colors.text }}>
            <X size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
