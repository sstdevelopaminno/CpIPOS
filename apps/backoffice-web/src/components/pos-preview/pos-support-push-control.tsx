"use client";

import { useEffect, useState } from "react";

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

type PushState = "unsupported" | "default" | "denied" | "ready" | "busy";

async function detectPushState(): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "default";
  try {
    const registration = await navigator.serviceWorker.ready;
    return (await registration.pushManager.getSubscription()) ? "ready" : "default";
  } catch {
    return "default";
  }
}

async function subscribePush(requestPermission: boolean): Promise<PushState> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  let permission = Notification.permission;
  if (requestPermission && permission === "default") permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "default";

  try {
    const registration = await navigator.serviceWorker.ready;
    const keyResponse = await fetch("/api/pos/support-chat/push-subscription", { cache: "no-store" });
    const keyBody = await keyResponse.json() as { data?: { public_key?: string } };
    const publicKey = String(keyBody?.data?.public_key || "");
    if (!keyResponse.ok || !publicKey) throw new Error("push_key_unavailable");

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(publicKey)
      });
    }
    const save = await fetch("/api/pos/support-chat/push-subscription", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(subscription.toJSON())
    });
    if (!save.ok) throw new Error("push_subscription_failed");
    return "ready";
  } catch {
    return "default";
  }
}

/** Headless bridge: keep foreground push messages working after the sidebar button moved to Settings. */
export function PosSupportPushBridge() {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "CPIPOS_PUSH_NOTIFICATION") return;
      window.dispatchEvent(new CustomEvent("cpipos-pos-push-notification", { detail: event.data.payload }));
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);
  return null;
}

export function PosSupportPushSettingsModal({ open, onClose, lang }: {
  open: boolean;
  onClose: () => void;
  lang: "th" | "en";
}) {
  const [state, setState] = useState<PushState>("default");

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    let cancelled = false;
    void detectPushState().then((next) => {
      if (!cancelled) setState(next);
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  async function enable() {
    setState("busy");
    setState(await subscribePush(true));
  }

  if (!open) return null;

  const th = lang !== "en";
  const labels = {
    title: th ? "การแจ้งเตือนอุปกรณ์" : "Device Notifications",
    desc: th ? "จัดการ Push Notification ของอุปกรณ์ที่กำลังใช้งาน CpiPOS เครื่องนี้" : "Manage Push Notifications for this CpiPOS device.",
    ready: th ? "เปิดใช้งานแล้ว" : "Enabled",
    denied: th ? "เบราว์เซอร์บล็อกการแจ้งเตือน" : "Blocked by browser",
    unsupported: th ? "อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับ Push Notification" : "Push Notifications are not supported on this device.",
    idle: th ? "ยังไม่ได้เปิดใช้งาน" : "Not enabled",
    busy: th ? "กำลังเปิดใช้งาน..." : "Enabling...",
    enable: th ? "เปิดการแจ้งเตือน" : "Enable notifications",
    close: th ? "ปิด" : "Close",
    hint: th ? "เมื่อเปิดแล้ว ระบบสามารถแจ้งข้อความ Support และเหตุการณ์สำคัญที่บริษัทอนุญาตสำหรับร้านนี้ได้" : "Once enabled, CpiPOS can deliver support messages and approved system notifications for this store."
  };
  const status = state === "ready" ? labels.ready : state === "denied" ? labels.denied : state === "unsupported" ? labels.unsupported : state === "busy" ? labels.busy : labels.idle;

  return (
    <div role="dialog" aria-modal="true" aria-label={labels.title} className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/55 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-xl">🔔</span>
            <div>
              <h3 className="text-lg font-black text-slate-950">{labels.title}</h3>
              <p className="mt-1 text-sm font-medium leading-5 text-slate-500">{labels.desc}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label={labels.close}>×</button>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-3">
            <span className={`h-3 w-3 rounded-full ${state === "ready" ? "bg-emerald-500" : state === "denied" || state === "unsupported" ? "bg-red-500" : "bg-amber-400"}`} />
            <div>
              <p className="text-sm font-black text-slate-900">{status}</p>
              <p className="mt-1 text-xs font-medium leading-5 text-slate-500">{labels.hint}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700">{labels.close}</button>
          {state !== "ready" && state !== "unsupported" && state !== "denied" ? (
            <button type="button" onClick={() => void enable()} disabled={state === "busy"} className="h-10 rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
              {state === "busy" ? labels.busy : labels.enable}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/** Kept for backward compatibility; new UI uses the Settings modal instead of rendering this in the sidebar. */
export function PosSupportPushControl({ compact, horizontal }: { compact: boolean; horizontal: boolean }) {
  const [state, setState] = useState<PushState>("default");
  useEffect(() => {
    void detectPushState().then(setState);
  }, []);
  if (state === "unsupported") return null;
  const label = state === "ready" ? "แจ้งเตือนเปิดแล้ว" : state === "denied" ? "แจ้งเตือนถูกบล็อก" : state === "busy" ? "กำลังเปิด..." : "เปิดแจ้งเตือน";
  return <button
    type="button"
    onClick={async () => { setState("busy"); setState(await subscribePush(true)); }}
    disabled={state === "busy" || state === "ready"}
    className={`group inline-flex min-h-[40px] items-center rounded-xl border border-white/15 bg-white/5 text-[12px] font-semibold text-slate-100 transition hover:bg-white/10 disabled:opacity-70 ${horizontal ? "w-auto gap-2 px-3" : compact ? "w-full justify-center px-2" : "w-full justify-start gap-2 px-2"}`}
    title={compact ? label : undefined}
  >
    <span aria-hidden>🔔</span>
    {!compact ? <span className="truncate">{label}</span> : null}
  </button>;
}
