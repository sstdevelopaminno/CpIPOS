"use client";

import { useEffect, useState } from "react";

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

type PushState = "unsupported" | "default" | "denied" | "ready" | "busy";

export function PosSupportPushControl({ compact, horizontal }: { compact: boolean; horizontal: boolean }) {
  const [state, setState] = useState<PushState>("default");

  async function subscribe(requestPermission: boolean) {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    let permission = Notification.permission;
    if (requestPermission && permission === "default") permission = await Notification.requestPermission();
    if (permission === "denied") {
      setState("denied");
      return;
    }
    if (permission !== "granted") {
      setState("default");
      return;
    }

    setState("busy");
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
      setState("ready");
    } catch {
      setState("default");
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("Notification" in window && Notification.permission === "granted") void subscribe(false);

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "CPIPOS_PUSH_NOTIFICATION") return;
      window.dispatchEvent(new CustomEvent("cpipos-pos-push-notification", { detail: event.data.payload }));
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  if (state === "unsupported") return null;
  const label = state === "ready" ? "แจ้งเตือนเปิดแล้ว" : state === "denied" ? "แจ้งเตือนถูกบล็อก" : state === "busy" ? "กำลังเปิด..." : "เปิดแจ้งเตือน";
  return <button
    type="button"
    onClick={() => void subscribe(true)}
    disabled={state === "busy" || state === "ready"}
    className={`group inline-flex min-h-[40px] items-center rounded-xl border border-white/15 bg-white/5 text-[12px] font-semibold text-slate-100 transition hover:bg-white/10 disabled:opacity-70 ${horizontal ? "w-auto gap-2 px-3" : compact ? "w-full justify-center px-2" : "w-full justify-start gap-2 px-2"}`}
    title={compact ? label : undefined}
  >
    <span aria-hidden>🔔</span>
    {!compact ? <span className="truncate">{label}</span> : null}
  </button>;
}
