"use client";

import { useLayoutEffect } from "react";
import LoginDevicesPageContent from "./page-content";

type CpIPOSMdmBridge = {
  diagnosticsJson?: () => string;
};

type NativeAndroidIdentity = {
  installId: string;
  appVersion: string | null;
};

function readNativeAndroidIdentity(): NativeAndroidIdentity | null {
  try {
    const nativeWindow = window as Window & {
      CpIPOSMdm?: CpIPOSMdmBridge;
      CpiposMdm?: CpIPOSMdmBridge;
    };
    // CpiposMdm is the bridge name shipped by Android POS 1.0.2.
    // Keep CpIPOSMdm as a forward-compatible alias for newer runtimes.
    const bridge = nativeWindow.CpIPOSMdm ?? nativeWindow.CpiposMdm;
    const raw = bridge?.diagnosticsJson?.();
    if (!raw) return null;

    const snapshot = JSON.parse(raw) as {
      install_id?: unknown;
      app?: { version_name?: unknown } | null;
    };
    const installId = String(snapshot.install_id ?? "").trim();
    if (!installId) return null;

    const appVersion = String(snapshot.app?.version_name ?? "").trim() || null;
    return { installId, appVersion };
  } catch {
    return null;
  }
}

function NativeAndroidDevicePairingBridge() {
  useLayoutEffect(() => {
    const nativeIdentity = readNativeAndroidIdentity();
    if (!nativeIdentity) return undefined;

    const previousFetch = window.fetch;
    const patchedFetch: typeof window.fetch = async (input, init) => {
      try {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        const pathname = new URL(requestUrl, window.location.origin).pathname;
        const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

        if (pathname !== "/api/auth/devices/select" || method !== "POST" || typeof init?.body !== "string") {
          return previousFetch(input, init);
        }

        const parsed = JSON.parse(init.body) as Record<string, unknown> | null;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return previousFetch(input, init);
        }

        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init.headers).forEach((value, key) => headers.set(key, value));
        headers.set("Content-Type", "application/json");
        headers.set("X-CpIPOS-Android-POS", "true");

        return previousFetch(input, {
          ...init,
          headers,
          body: JSON.stringify({
            ...parsed,
            android_install_id: nativeIdentity.installId,
            android_app_version: nativeIdentity.appVersion
          })
        });
      } catch {
        // Native pairing metadata is an enhancement for the Android runtime.
        // Never break the existing device-selection request if the bridge is unavailable.
        return previousFetch(input, init);
      }
    };

    window.fetch = patchedFetch;
    return () => {
      if (window.fetch === patchedFetch) window.fetch = previousFetch;
    };
  }, []);

  return null;
}

export default function LoginDevicesPage() {
  return (
    <>
      <NativeAndroidDevicePairingBridge />
      <LoginDevicesPageContent />
    </>
  );
}
